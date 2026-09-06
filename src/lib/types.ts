export type Role = 'doctor' | 'admin'
export type DecisionStatus = 'accepted' | 'rejected' | 'deferred'
export type WorkStage = 'interest' | 'contact' | 'feasibility' | 'submission' | 'active' | 'closed'

export interface Profile {
  id: string
  full_name: string
  email: string
  role: Role
  specialty: string | null
  categories: string[]   // подписки; [] = все категории
  cc_emails: string[]
  is_active: boolean
}

export interface Trial {
  id: string
  nct_id: string
  title: string
  title_ru: string | null
  summary_ru: string
  category: string
  recruitment_status: string
  is_upcoming: boolean
  sponsor: string | null
  phase: string | null
  countries: string[]
  conditions: string[]
  source_url: string
  first_posted: string | null
  first_seen_at: string
  score: number | null           // 0-100, скоринг из радара
  score_reasons: string[]        // почему именно столько баллов
}

export function scoreColor(score: number | null): string {
  if (score == null) return 'var(--muted)'
  if (score >= 85) return 'var(--red)'      // 🔥 горячее
  if (score >= 70) return 'var(--amber)'    // тёплое
  return 'var(--muted)'
}

export function scoreLabel(score: number | null): string {
  if (score == null) return ''
  if (score >= 85) return 'Горячее'
  if (score >= 70) return 'Тёплое'
  return 'Наблюдение'
}

export interface Decision {
  user_id: string
  trial_id: string
  status: DecisionStatus
  work_stage: WorkStage | null
  note: string | null
  decided_at: string
}

export interface Group {
  id: string
  name: string
  created_at?: string
}

export interface GroupMember {
  group_id: string
  user_id: string
  added_at?: string
}

// Профиль коллеги по группе — то, что отдаёт RLS-политика profiles_group_read.
export interface Peer {
  id: string
  full_name: string
  email: string
  specialty: string | null
}

export function peerName(p: { full_name: string; email: string }): string {
  return p.full_name || p.email.split('@')[0]
}

export const STATUS_GLYPH: Record<DecisionStatus, string> = {
  accepted: '✅',
  rejected: '❌',
  deferred: '🕐',
}

export const STATUS_LABEL: Record<DecisionStatus, string> = {
  accepted: 'Принято',
  rejected: 'Отклонено',
  deferred: 'Отложено',
}

export interface Digest {
  id: string
  week_start: string
}

// Канонический словарь категорий. Ключи совпадают с деривацией в боте
// (см. scripts/sync_to_db.mjs) и хранятся в trials.category / profiles.categories.
export const CATEGORIES: Record<string, string> = {
  arrhythmia: 'Аритмология',
  structural: 'Структурные вмешательства',
  hf: 'Сердечная недостаточность',
  mcs: 'Мех. поддержка кровообращения',
  antithrombotic: 'Антитромботическая терапия',
  antiarrhythmic: 'Антиаритмическая терапия',
  devices: 'Устройства (прочее)',
  other: 'Другое',
}

export const STAGES: Record<WorkStage, string> = {
  interest: 'Интерес',
  contact: 'Контакт со спонсором',
  feasibility: 'Feasibility',
  submission: 'Подача центра',
  active: 'Центр участвует',
  closed: 'Завершено',
}

export const STAGE_ORDER: WorkStage[] = ['interest', 'contact', 'feasibility', 'submission', 'active', 'closed']

export const STATUS_COLORS: Record<string, string> = {
  'RECRUITING': 'var(--green)',
  'NOT_YET_RECRUITING': 'var(--amber)',
  'ACTIVE_NOT_RECRUITING': 'var(--muted)',
  'ENROLLING_BY_INVITATION': 'var(--teal)',
}

export function statusLabel(s: string): string {
  const map: Record<string, string> = {
    RECRUITING: 'Набор идёт',
    NOT_YET_RECRUITING: 'Набор скоро',
    ACTIVE_NOT_RECRUITING: 'Без набора',
    ENROLLING_BY_INVITATION: 'По приглашению',
    COMPLETED: 'Завершено',
    SUSPENDED: 'Приостановлено',
  }
  const key = s.toUpperCase().replace(/[ ,]+/g, '_')
  return map[key] ?? s
}

export function statusColor(s: string): string {
  const key = s.toUpperCase().replace(/[ ,]+/g, '_')
  return STATUS_COLORS[key] ?? 'var(--muted)'
}

// ---------------------------------------------------------------- контакты
// Кому писать по исследованию. Лежит в trial_contacts, видит только админ:
// врачам outreach-данные не показываем (см. 003_trial_contacts.sql).

export interface ContactPerson {
  name: string
  role: string
  email: string
  phone: string
  ext: string
}

export interface Official {
  name: string
  affiliation: string
  role: string
}

export interface ContactSite {
  facility: string
  city: string
  country: string
  status: string
  contacts: ContactPerson[]
}

// Тело записи — то, что отдаёт ClinicalTrials.gov после маппинга.
export interface TrialContactsData {
  lead_sponsor: string | null
  sponsor_class: string | null
  collaborators: string[]
  responsible_party: string | null
  central_contacts: ContactPerson[]
  officials: Official[]
  sites: ContactSite[]
  sites_total: number
  enrollment: number | null
  start_date: string | null
  completion_date: string | null
  last_update_posted: string | null
}

export interface TrialContacts extends TrialContactsData {
  trial_id: string
  fetched_at: string
}

// Сколько живых способов связаться есть в карточке.
export function contactWays(c: TrialContacts | TrialContactsData | undefined): number {
  if (!c) return 0
  return c.central_contacts.length + c.sites.reduce((n, s) => n + s.contacts.length, 0)
}

export const SPONSOR_CLASS: Record<string, string> = {
  INDUSTRY: 'Индустрия',
  NIH: 'NIH',
  FED: 'Госструктура',
  OTHER_GOV: 'Госструктура',
  NETWORK: 'Исследовательская сеть',
  INDIV: 'Частный исследователь',
  OTHER: 'Прочее',
  UNKNOWN: '',
}

export const CONTACT_ROLE: Record<string, string> = {
  CONTACT: 'контактное лицо',
  STUDY_CHAIR: 'председатель исследования',
  STUDY_DIRECTOR: 'директор исследования',
  PRINCIPAL_INVESTIGATOR: 'главный исследователь',
  SUB_INVESTIGATOR: 'соисследователь',
}

export function roleLabel(role: string): string {
  if (!role) return ''
  return CONTACT_ROLE[role.toUpperCase()] ?? role.split('_').join(' ').toLowerCase()
}
