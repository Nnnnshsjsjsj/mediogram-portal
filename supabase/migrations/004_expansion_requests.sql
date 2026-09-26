-- Mediogram Portal — schema v4: заявки на новые направления
--
-- Врач описывает направление вне кардиологии (урология, онкология…): подобласти,
-- заболевания, ключевые слова для радара, возможности центра. Администратор
-- видит заявку, ведёт её по статусам и на её основе заводит категории и группу.
--
-- Сам чеклист хранится в jsonb `data`: состав полей будет меняться по мере
-- того, как появятся новые направления, и не хочется на каждое поле делать
-- миграцию. Форма типизирована на фронтенде (src/lib/types.ts → ExpansionData).

create table if not exists public.expansion_requests (
  id           uuid primary key default gen_random_uuid(),
  created_by   uuid not null references public.profiles(id) on delete cascade,
  status       text not null default 'draft'
               check (status in ('draft','submitted','in_review','needs_info','approved','live','rejected')),
  -- Дублируем из data, чтобы фильтровать и сортировать без jsonb-операторов.
  field_ru     text not null default '',
  field_en     text not null default '',
  data         jsonb not null default '{}'::jsonb,
  -- Ответ администратора врачу (виден автору).
  admin_note   text,
  -- Внутренние пометки администратора: { group_id, assignee, checklist… }. Врачу не видны — фронт их не запрашивает.
  admin_data   jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists expansion_requests_status_idx on public.expansion_requests (status, updated_at desc);
create index if not exists expansion_requests_author_idx on public.expansion_requests (created_by);

comment on table public.expansion_requests is
  'Заявки врачей на подключение нового медицинского направления к порталу.';

-- updated_at + защита админских полей от правки врачом.
create or replace function public.expansion_requests_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and not public.is_admin() then
    -- Врач не может менять ответ администратора и внутренние пометки.
    new.admin_note  := old.admin_note;
    new.admin_data  := old.admin_data;
    new.reviewed_at := old.reviewed_at;
    new.created_by  := old.created_by;
  end if;
  if new.status = 'submitted' and (old.status is distinct from 'submitted') then
    new.submitted_at := now();
  end if;
  return new;
end $$;

drop trigger if exists expansion_requests_guard on public.expansion_requests;
create trigger expansion_requests_guard
  before insert or update on public.expansion_requests
  for each row execute function public.expansion_requests_guard();

alter table public.expansion_requests enable row level security;

-- Читать: автор свои, админ все.
drop policy if exists expansion_select on public.expansion_requests;
create policy expansion_select on public.expansion_requests for select
  using (created_by = auth.uid() or public.is_admin());

-- Создавать: только от своего имени, только черновик или сразу отправленную.
drop policy if exists expansion_insert_own on public.expansion_requests;
create policy expansion_insert_own on public.expansion_requests for insert
  with check (created_by = auth.uid() and status in ('draft','submitted'));

-- Править: автор — пока заявка в черновике или возвращена на доработку,
-- и перевести её может только в черновик или в «отправлена».
drop policy if exists expansion_update_own on public.expansion_requests;
create policy expansion_update_own on public.expansion_requests for update
  using (created_by = auth.uid() and status in ('draft','needs_info'))
  with check (created_by = auth.uid() and status in ('draft','submitted'));

-- Удалять: автор — только свой черновик.
drop policy if exists expansion_delete_own on public.expansion_requests;
create policy expansion_delete_own on public.expansion_requests for delete
  using (created_by = auth.uid() and status = 'draft');

-- Админ — всё.
drop policy if exists expansion_admin_all on public.expansion_requests;
create policy expansion_admin_all on public.expansion_requests for all
  using (public.is_admin()) with check (public.is_admin());
