-- Mediogram Portal — schema v1
-- Запускается один раз в Supabase SQL Editor (или supabase db push).

-- ============================================================ profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text not null unique,
  role        text not null default 'doctor' check (role in ('doctor','admin')),
  specialty   text,
  -- Подписки врача на категории. Пустой массив = получает всё.
  categories  text[] not null default '{}',
  -- Коллеги, которых ставим в копию еженедельного письма.
  cc_emails   text[] not null default '{}',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Профиль создаётся автоматически при появлении auth-пользователя.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================ trials
create table if not exists public.trials (
  id                 uuid primary key default gen_random_uuid(),
  nct_id             text not null unique,
  title              text not null,
  title_ru           text,
  summary_ru         text not null default '',
  category           text not null default 'other',
  recruitment_status text not null default '',
  is_upcoming        boolean not null default false,
  sponsor            text,
  phase              text,
  countries          text[] not null default '{}',
  conditions         text[] not null default '{}',
  source_url         text not null default '',
  first_posted       date,
  first_seen_at      timestamptz not null default now(),
  last_updated_at    timestamptz not null default now(),
  raw                jsonb
);
create index if not exists trials_category_idx on public.trials (category);
create index if not exists trials_status_idx   on public.trials (recruitment_status);
create index if not exists trials_seen_idx     on public.trials (first_seen_at desc);

-- ============================================================ digests
create table if not exists public.digests (
  id          uuid primary key default gen_random_uuid(),
  week_start  date not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists public.digest_trials (
  digest_id  uuid not null references public.digests(id) on delete cascade,
  trial_id   uuid not null references public.trials(id) on delete cascade,
  section    text not null check (section in ('current','upcoming')),
  rank       int not null default 0,
  primary key (digest_id, trial_id)
);

-- ============================================================ decisions
-- Одно актуальное решение на пару (врач, исследование).
-- «Принять» = интерес. Когда работа реально начинается, решение двигается
-- по мини-workflow через поле work_stage.
create table if not exists public.decisions (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  trial_id    uuid not null references public.trials(id) on delete cascade,
  status      text not null check (status in ('accepted','rejected','deferred')),
  -- work_stage заполняется только для accepted:
  --   interest    — интерес зафиксирован (по умолчанию при «Принять»)
  --   contact     — связались со спонсором/CRO
  --   feasibility — заполняем feasibility-анкету
  --   submission  — центр подан в исследование
  --   active      — центр участвует
  --   closed      — работа по исследованию завершена
  work_stage  text check (work_stage in
              ('interest','contact','feasibility','submission','active','closed')),
  note        text,
  decided_at  timestamptz not null default now(),
  primary key (user_id, trial_id),
  constraint stage_only_for_accepted
    check (status = 'accepted' or work_stage is null)
);

-- Журнал изменений — для админ-аналитики «кто когда что менял».
create table if not exists public.decision_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  trial_id   uuid not null,
  status     text not null,
  work_stage text,
  created_at timestamptz not null default now()
);

create or replace function public.log_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.decision_events (user_id, trial_id, status, work_stage)
  values (new.user_id, new.trial_id, new.status, new.work_stage);
  return new;
end $$;

drop trigger if exists decisions_audit on public.decisions;
create trigger decisions_audit
  after insert or update on public.decisions
  for each row execute function public.log_decision();

-- ============================================================ watches (вкладка Upcoming)
create table if not exists public.watches (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  trial_id   uuid not null references public.trials(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, trial_id)
);

-- ============================================================ activity_log
create table if not exists public.activity_log (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles(id) on delete set null,
  event      text not null,   -- login | digest_view | email_open | email_click | digest_sent
  meta       jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================ helpers
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ============================================================ RLS
alter table public.profiles        enable row level security;
alter table public.trials          enable row level security;
alter table public.digests         enable row level security;
alter table public.digest_trials   enable row level security;
alter table public.decisions       enable row level security;
alter table public.decision_events enable row level security;
alter table public.watches         enable row level security;
alter table public.activity_log    enable row level security;

-- profiles: свой профиль читаем/правим сами; админ видит и правит все.
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));
create policy profiles_admin_all on public.profiles for all
  using (public.is_admin()) with check (public.is_admin());

-- trials / digests: читают все авторизованные; пишет только бот (service role, минуя RLS).
create policy trials_read  on public.trials        for select using (auth.uid() is not null);
create policy digests_read on public.digests       for select using (auth.uid() is not null);
create policy dt_read      on public.digest_trials for select using (auth.uid() is not null);

-- decisions: врач управляет ТОЛЬКО своими; чужие решения не видны никому,
-- кроме админа (доктора не видят выборы друг друга — намеренно).
create policy decisions_own on public.decisions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy decisions_admin_read on public.decisions for select
  using (public.is_admin());

create policy events_admin_read on public.decision_events for select
  using (public.is_admin());

-- watches: только свои.
create policy watches_own on public.watches for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- activity_log: пользователь пишет события о себе, читает админ.
create policy activity_insert_own on public.activity_log for insert
  with check (user_id = auth.uid());
create policy activity_admin_read on public.activity_log for select
  using (public.is_admin());
