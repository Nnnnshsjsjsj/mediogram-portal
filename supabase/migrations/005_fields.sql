-- Mediogram Portal — schema v5: терапевтические направления (кардиология, онкология)
--
-- Каждое направление — отдельная вкладка триажа. Радар (v8) помечает каждое
-- исследование полем field; выпуск недели остаётся одним (digests.week_start
-- уникален), но в нём своя двадцатка на каждое направление — фронт фильтрует
-- digest_trials по trials.field.
--
-- Миграция обратно совместима: всё, что было до неё, становится кардиологией.

-- ============================================================ trials.field
alter table public.trials
  add column if not exists field text not null default 'cardiology';
create index if not exists trials_field_idx on public.trials (field, first_seen_at desc);

comment on column public.trials.field is
  'Терапевтическое направление: cardiology | oncology. Проставляет радар; по нему строятся вкладки триажа.';

-- ============================================================ profiles.fields
-- К каким направлениям у врача есть доступ. Администраторы видят все
-- направления независимо от этого поля (это решает фронт).
alter table public.profiles
  add column if not exists fields text[] not null default '{cardiology}';

comment on column public.profiles.fields is
  'Направления, доступные врачу: вкладки триажа и разделы письма. Управляет администратор.';

-- Врач может править свой профиль (имя, специальность, подписки), но не
-- выдавать себе направления — это делает администратор.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() пуст у service role (скрипты GitHub Actions, SQL-консоль) — им можно всё.
  if auth.uid() is not null and not public.is_admin() then
    new.fields    := old.fields;
    new.role      := old.role;
    new.is_active := old.is_active;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

revoke execute on function public.profiles_guard() from public, anon, authenticated;
