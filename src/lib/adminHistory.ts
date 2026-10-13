// Данные для мониторинга в админке: выпуски по неделям, журнал выборов
// и время последней активности врачей.
//
// Откуда что берётся:
// - decisions хранит только ПОСЛЕДНЕЕ решение врача по исследованию —
//   каждое изменение перезаписывает строку, история теряется;
// - decision_events пишет триггер decisions_audit на каждый insert/update
//   (см. 001_init.sql), поэтому история выборов живёт там. Тот же триггер
//   срабатывает на смену этапа и правку заметки — такие строки не являются
//   «выбором», их отсекает pickEvents();
// - activity_log — входы, просмотры выпуска и т.п.; последнее событие
//   пользователя считаем временем, когда он был онлайн.
// Все три таблицы читает только админ (политики events_admin_read и
// activity_admin_read).

import { supabase } from './supabase'
import type { DecisionStatus, Trial, WorkStage } from './types'

export interface DigestWeek {
  id: string
  week_start: string   // понедельник выпуска, YYYY-MM-DD
  created_at: string
}

export interface DecisionEvent {
  id: number
  user_id: string
  trial_id: string
  status: DecisionStatus
  work_stage: WorkStage | null
  created_at: string
}

export interface DigestRow {
  trial: Trial
  section: 'current' | 'upcoming' | string
  rank: number
}

export async function adminGetDigests(): Promise<DigestWeek[]> {
  const { data, error } = await supabase
    .from('digests').select('id, week_start, created_at')
    .order('week_start', { ascending: false })
  if (error) throw error
  return (data ?? []) as DigestWeek[]
}

export async function adminGetDigestRows(digestId: string): Promise<DigestRow[]> {
  const { data, error } = await supabase
    .from('digest_trials').select('section, rank, trials(*)')
    .eq('digest_id', digestId).order('rank')
  if (error) throw error
  return (data ?? [])
    .map((r) => ({
      trial: r.trials as unknown as Trial,
      section: r.section as string,
      rank: r.rank as number,
    }))
    .filter((r) => Boolean(r.trial))
}

export async function adminGetDecisionEvents(): Promise<DecisionEvent[]> {
  const { data, error } = await supabase
    .from('decision_events').select('id, user_id, trial_id, status, work_stage, created_at')
    .order('created_at', { ascending: true }).limit(10000)
  if (error) throw error
  return (data ?? []) as DecisionEvent[]
}

/** user_id → ISO-время последнего события в activity_log за 90 дней. */
export async function adminGetLastSeen(): Promise<Map<string, string>> {
  const since = new Date(Date.now() - 90 * 86400_000).toISOString()
  const { data, error } = await supabase
    .from('activity_log').select('user_id, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false }).limit(5000)
  if (error) throw error
  const map = new Map<string, string>()
  for (const r of (data ?? []) as { user_id: string | null; created_at: string }[]) {
    if (r.user_id && !map.has(r.user_id)) map.set(r.user_id, r.created_at)
  }
  return map
}

/**
 * Только настоящие выборы: первое событие пары врач–исследование и каждое
 * событие, где статус сменился. Смена этапа и правка заметки сюда не попадают.
 * Ожидает события, отсортированные по времени по возрастанию.
 */
export function pickEvents(events: DecisionEvent[]): DecisionEvent[] {
  const last = new Map<string, DecisionStatus>()
  const out: DecisionEvent[] = []
  for (const e of events) {
    const key = `${e.user_id}:${e.trial_id}`
    if (last.get(key) !== e.status) out.push(e)
    last.set(key, e.status)
  }
  return out
}

/** Состояние на момент `asOf`: последний выбор каждой пары не позже этого времени. */
export function stateAsOf(picks: DecisionEvent[], asOfMs: number): Map<string, DecisionEvent> {
  const m = new Map<string, DecisionEvent>()
  for (const e of picks) {
    if (new Date(e.created_at).getTime() > asOfMs) break
    m.set(`${e.user_id}:${e.trial_id}`, e)
  }
  return m
}

// ---------------------------------------------------------------- время

const DAY = 86400_000

/** «только что», «12 мин назад», «вчера в 14:02», «3 дн. назад», «12.09». */
export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (isNaN(t)) return '—'
  const diff = now - t
  if (diff < 60_000) return 'только что'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} мин назад`
  const d = new Date(t)
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  if (t >= today.getTime()) return `сегодня в ${hm}`
  if (t >= today.getTime() - DAY) return `вчера в ${hm}`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} дн. назад`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

/**
 * Короткая метка для ячейки. Свежее (до 6 дней) — «пн 14:02»; старше —
 * дата «24.08», иначе давний выбор выглядит как вчерашний.
 */
export function shortStamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  if (Date.now() - d.getTime() >= 6 * DAY) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  }
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '')
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return `${wd} ${hm}`
}

/** Полная дата-время для подсказки. */
export function fullStamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })
}

/** «13–19 октября» по понедельнику выпуска. */
export function weekLabel(weekStart: string): string {
  const s = new Date(`${weekStart}T00:00:00`)
  if (isNaN(s.getTime())) return weekStart
  const e = new Date(s.getTime() + 6 * DAY)
  const sameMonth = s.getMonth() === e.getMonth()
  const day = (d: Date) => d.toLocaleDateString('ru-RU', { day: 'numeric' })
  const month = (d: Date) => d.toLocaleDateString('ru-RU', { month: 'long', day: 'numeric' }).replace(/^\d+\s/, '')
  return sameMonth
    ? `${day(s)}–${day(e)} ${month(e)}`
    : `${day(s)} ${month(s)} – ${day(e)} ${month(e)}`
}

/** Онлайн за последние N минут — зелёная точка у врача. */
export function isRecent(iso: string | null | undefined, minutes = 15): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() < minutes * 60_000
}
