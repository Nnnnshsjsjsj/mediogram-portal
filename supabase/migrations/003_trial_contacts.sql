-- Mediogram Portal — schema v3: контакты спонсора по исследованию
--
-- Зачем отдельная таблица, а не колонки в trials: trials читают ВСЕ врачи
-- (политика trials_read), а контакты спонсора — это outreach-данные, которые
-- видит только администратор. Поэтому таблица отдельная и закрыта is_admin().
--
-- Наполняется двумя путями, оба пишут одну и ту же структуру:
--   1) scripts/fetch_contacts.mjs в GitHub Actions (service role, минуя RLS);
--   2) кнопкой «Обновить контакты» в админ-панели (src/lib/ctg.ts, из браузера).

create table if not exists public.trial_contacts (
  trial_id          uuid primary key references public.trials(id) on delete cascade,
  -- Кто ведёт исследование
  lead_sponsor      text,
  sponsor_class     text,              -- INDUSTRY | NIH | OTHER …
  collaborators     text[]  not null default '{}',
  responsible_party text,
  -- Кому писать. [{ name, role, email, phone, ext }]
  central_contacts  jsonb   not null default '[]'::jsonb,
  -- Ответственные исследователи. [{ name, affiliation, role }]
  officials         jsonb   not null default '[]'::jsonb,
  -- Центры с собственными контактами. [{ facility, city, country, status, contacts:[…] }]
  sites             jsonb   not null default '[]'::jsonb,
  sites_total       int     not null default 0,
  -- Полезный контекст для переговоров
  enrollment        int,
  start_date        text,
  completion_date   text,
  last_update_posted text,
  fetched_at        timestamptz not null default now()
);

comment on table public.trial_contacts is
  'Контакты спонсора/CRO по исследованию. Источник — ClinicalTrials.gov. Только для админов.';

alter table public.trial_contacts enable row level security;

-- Ни одной политики для роли doctor: врач эту таблицу не видит вовсе.
drop policy if exists trial_contacts_admin_all on public.trial_contacts;
create policy trial_contacts_admin_all on public.trial_contacts for all
  using (public.is_admin()) with check (public.is_admin());
