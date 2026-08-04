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
}

export interface Decision {
  user_id: string
  trial_id: string
  status: DecisionStatus
  work_stage: WorkStage | null
  note: string | null
  decided_at: string
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
