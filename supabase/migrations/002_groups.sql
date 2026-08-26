-- Mediogram Portal — schema v2: группы врачей
-- Врачи одной группы видят решения, этапы работы и заметки друг друга.
-- Редактировать чужое нельзя: групповой доступ — только на чтение.

-- ============================================================ groups
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id);

-- ============================================================ helpers
-- SECURITY DEFINER, иначе политика на group_members рекурсивно вызовет саму себя.

-- Есть ли у текущего пользователя общая группа с target.
create or replace function public.shares_group_with(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.group_members me
    join public.group_members peer on peer.group_id = me.group_id
    where me.user_id = auth.uid() and peer.user_id = target
  )
$$;

-- Состоит ли текущий пользователь в группе g.
create or replace function public.is_group_member(g uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members
    where group_id = g and user_id = auth.uid()
  )
$$;

-- Анонимным эти функции не нужны — закрываем, чтобы не плодить
-- предупреждения линтера про публично исполняемые SECURITY DEFINER.
revoke execute on function public.shares_group_with(uuid) from public, anon;
revoke execute on function public.is_group_member(uuid)  from public, anon;
grant  execute on function public.shares_group_with(uuid) to authenticated;
grant  execute on function public.is_group_member(uuid)  to authenticated;

-- ============================================================ RLS
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

-- Группу видит её участник; админ видит все.
drop policy if exists groups_member_read on public.groups;
create policy groups_member_read on public.groups for select
  using (public.is_group_member(id) or public.is_admin());

drop policy if exists groups_admin_all on public.groups;
create policy groups_admin_all on public.groups for all
  using (public.is_admin()) with check (public.is_admin());

-- Состав группы видят её участники и админ.
drop policy if exists gm_member_read on public.group_members;
create policy gm_member_read on public.group_members for select
  using (user_id = auth.uid() or public.is_group_member(group_id) or public.is_admin());

drop policy if exists gm_admin_all on public.group_members;
create policy gm_admin_all on public.group_members for all
  using (public.is_admin()) with check (public.is_admin());

-- Решения коллег по группе — только чтение (статус, этап, заметка).
-- Право на запись даёт лишь decisions_own, поэтому чужое решение не изменить.
drop policy if exists decisions_group_read on public.decisions;
create policy decisions_group_read on public.decisions for select
  using (public.shares_group_with(user_id));

-- Профили коллег по группе — чтобы подписать колонки именами.
drop policy if exists profiles_group_read on public.profiles;
create policy profiles_group_read on public.profiles for select
  using (public.shares_group_with(id));
