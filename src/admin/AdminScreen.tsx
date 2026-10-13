import { useEffect, useMemo, useRef, useState } from 'react'
import {
  adminAddMember, adminCreateGroup, adminDeleteGroup, adminGetAllDecisions,
  adminGetDoctors, adminGetGroupMembers, adminGetGroups, adminGetTrialContacts, adminInvite,
  adminRemoveMember, adminRenameGroup, adminSaveTrialContacts, adminSetStage, adminUpdateDoctor,
  getTrialsByIds,
} from '../lib/api'
import {
  adminGetDecisionEvents, adminGetDigestRows, adminGetDigests, adminGetLastSeen,
  fullStamp, isRecent, pickEvents, shortStamp, stateAsOf, timeAgo, weekLabel,
} from '../lib/adminHistory'
import type { DecisionEvent, DigestRow, DigestWeek } from '../lib/adminHistory'
import { fetchTrialContacts } from '../lib/ctg'
import StageTracker from '../components/StageTracker'
import TrialCard from '../components/TrialCard'
import ContactPanel from '../components/ContactPanel'
import ExpansionAdmin from './ExpansionAdmin'
import type { Decision, DecisionStatus, Field, Group, GroupMember, Profile, Trial, TrialContacts, WorkStage } from '../lib/types'
import { CATEGORIES, FIELDS, FIELD_ORDER, STAGES, STATUS_LABEL, peerName, scoreColor, trialField } from '../lib/types'

type Section = 'monitor' | 'work' | 'people' | 'requests'

interface Cell { status: DecisionStatus; at: string; stage: WorkStage | null }

const DAY = 86400_000

const FIELD_COLOR: Record<Field, { fg: string; bg: string }> = {
  cardiology: { fg: 'var(--field-cardiology)', bg: 'var(--field-cardiology-soft)' },
  oncology: { fg: 'var(--field-oncology)', bg: 'var(--field-oncology-soft)' },
}

const STATUS_STYLE: Record<DecisionStatus, { fg: string; bg: string; icon: string; verb: string }> = {
  accepted: { fg: 'var(--green)', bg: 'var(--green-soft)', icon: '✓', verb: 'принял(а)' },
  rejected: { fg: 'var(--red)', bg: 'var(--red-soft)', icon: '✕', verb: 'отклонил(а)' },
  deferred: { fg: 'var(--amber)', bg: 'var(--amber-soft)', icon: '◷', verb: 'отложил(а)' },
}

function fieldsOf(d: Profile): Field[] {
  return (d.fields ?? ['cardiology']) as Field[]
}

// «Ольга Чадина» → «Чадина О.» — короче для заголовков колонок.
function shortName(p: { full_name: string; email: string }): string {
  const w = (p.full_name || '').trim().split(/\s+/).filter(Boolean)
  if (w.length >= 2) return `${w[w.length - 1]} ${w[0][0]}.`
  return peerName(p)
}

// 1 исследование, 2 исследования, 5 исследований.
function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return forms[0]
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1]
  return forms[2]
}

export default function AdminScreen() {
  const [section, setSection] = useState<Section>('monitor')
  const [field, setField] = useState<Field>('cardiology')

  const [doctors, setDoctors] = useState<Profile[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [trialMap, setTrialMap] = useState<Map<string, Trial>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')

  // мониторинг
  const [digests, setDigests] = useState<DigestWeek[]>([])
  const [weekId, setWeekId] = useState('')
  const [rows, setRows] = useState<DigestRow[]>([])
  const [rowsLoading, setRowsLoading] = useState(false)
  const [events, setEvents] = useState<DecisionEvent[]>([])
  const [lastSeen, setLastSeen] = useState<Map<string, string>>(new Map())
  const [showAllAdmins, setShowAllAdmins] = useState(false)
  const [order, setOrder] = useState<'rank' | 'accepted'>('rank')
  // Клик по «принято» в матрице открывает эту карточку во вкладке «В работе».
  const [focusKey, setFocusKey] = useState('')

  // врачи и группы
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteMsg, setInviteMsg] = useState('')
  const [inviteGroup, setInviteGroup] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [newGroup, setNewGroup] = useState('')
  const [groupMsg, setGroupMsg] = useState('')

  // контакты спонсоров
  const [contacts, setContacts] = useState<Map<string, TrialContacts>>(new Map())
  const [contactBusy, setContactBusy] = useState<Set<string>>(new Set())
  const [contactErr, setContactErr] = useState<Map<string, string>>(new Map())
  // Автодобор контактов запускаем один раз на исследование за сессию.
  const autoTried = useRef<Set<string>>(new Set())
  const autoRunning = useRef(false)
  // Исследования, которые уже запрашивали по id, — чтобы не крутить запросы по кругу.
  const requested = useRef<Set<string>>(new Set())

  function mergeTrials(list: Trial[]) {
    if (!list.length) return
    setTrialMap((prev) => {
      const m = new Map(prev)
      for (const t of list) m.set(t.id, t)
      return m
    })
  }

  async function loadAll() {
    try {
      const [docs, decs, gs, ms, dg, ev, seen] = await Promise.all([
        adminGetDoctors(), adminGetAllDecisions(), adminGetGroups(), adminGetGroupMembers(),
        adminGetDigests(), adminGetDecisionEvents(), adminGetLastSeen(),
      ])
      // Решение может быть по исследованию из прошлого выпуска — дотягиваем по id.
      const ids = [...new Set(decs.map((d) => d.trial_id))]
      for (const id of ids) requested.current.add(id)
      mergeTrials(await getTrialsByIds(ids))

      setDoctors(docs); setDecisions(decs); setGroups(gs); setMembers(ms)
      setDigests(dg); setEvents(ev); setLastSeen(seen)
      setWeekId((cur) => cur || dg[0]?.id || '')
      setLoadErr('')
      setLoading(false)

      const acceptedIds = decs.filter((d) => d.status === 'accepted').map((d) => d.trial_id)
      try { setContacts(await adminGetTrialContacts([...new Set(acceptedIds)])) } catch { /* контакты не критичны */ }
    } catch (e) {
      setLoadErr((e as Error).message)
      setLoading(false)
    }
  }
  useEffect(() => { loadAll() }, [])

  // Состав выбранного выпуска.
  useEffect(() => {
    if (!weekId) return
    let alive = true
    setRowsLoading(true)
    adminGetDigestRows(weekId)
      .then((r) => {
        if (!alive) return
        setRows(r)
        mergeTrials(r.map((x) => x.trial))
      })
      .catch(() => { if (alive) setRows([]) })
      .finally(() => { if (alive) setRowsLoading(false) })
    return () => { alive = false }
  }, [weekId])

  const picks = useMemo(() => pickEvents(events), [events])

  // В ленте бывают выборы по исследованиям не из выпуска — подгружаем их.
  useEffect(() => {
    const missing = [...new Set(picks.map((e) => e.trial_id))]
      .filter((id) => !trialMap.has(id) && !requested.current.has(id))
    if (!missing.length) return
    for (const id of missing) requested.current.add(id)
    getTrialsByIds(missing).then(mergeTrials).catch(() => { /* лента переживёт */ })
  }, [picks, trialMap])

  const doctorsById = useMemo(() => new Map(doctors.map((d) => [d.id, d])), [doctors])
  const activeDoctors = useMemo(() => doctors.filter((d) => d.is_active), [doctors])

  const decMap = useMemo(() => {
    const m = new Map<string, Decision>()
    for (const d of decisions) m.set(`${d.user_id}:${d.trial_id}`, d)
    return m
  }, [decisions])

  // Неделя: от появления выпуска до появления следующего.
  const weekIdx = digests.findIndex((d) => d.id === weekId)
  const week = weekIdx >= 0 ? digests[weekIdx] : undefined
  const isLatest = weekIdx === 0
  const weekStartMs = week ? new Date(week.created_at).getTime() : 0
  const weekEndMs = weekIdx > 0 ? new Date(digests[weekIdx - 1].created_at).getTime() : Date.now()

  // Текущая неделя — живые решения; прошлые — состояние на конец той недели из журнала.
  const asOf = useMemo(
    () => (isLatest ? null : stateAsOf(picks, weekEndMs)),
    [isLatest, picks, weekEndMs],
  )

  function cellFor(userId: string, trialId: string): Cell | null {
    if (asOf) {
      const e = asOf.get(`${userId}:${trialId}`)
      return e ? { status: e.status, at: e.created_at, stage: e.work_stage } : null
    }
    const d = decMap.get(`${userId}:${trialId}`)
    return d ? { status: d.status, at: d.decided_at, stage: d.work_stage } : null
  }

  const picks7 = useMemo(() => {
    const since = Date.now() - 7 * DAY
    const m = new Map<string, number>()
    for (const e of picks) if (new Date(e.created_at).getTime() > since) m.set(e.user_id, (m.get(e.user_id) ?? 0) + 1)
    return m
  }, [picks])

  // group_id -> врачи этой группы
  const groupMembers = useMemo(() => {
    const m = new Map<string, Profile[]>()
    for (const g of groups) m.set(g.id, [])
    for (const gm of members) {
      const doc = doctorsById.get(gm.user_id)
      if (doc) m.get(gm.group_id)?.push(doc)
    }
    for (const list of m.values()) list.sort((a, b) => peerName(a).localeCompare(peerName(b), 'ru'))
    return m
  }, [groups, members, doctorsById])

  // user_id -> названия групп
  const groupsOfDoctor = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const gm of members) {
      const g = groups.find((x) => x.id === gm.group_id)
      if (!g) continue
      m.set(gm.user_id, [...(m.get(gm.user_id) ?? []), g.name])
    }
    return m
  }, [members, groups])

  // Принятые исследования: кто принял и что именно. Свежие сверху.
  const accepted = useMemo(() => decisions
    .filter((d) => d.status === 'accepted')
    .map((d) => ({ d, doc: doctorsById.get(d.user_id), t: trialMap.get(d.trial_id) }))
    .filter((x): x is { d: Decision; doc: Profile; t: Trial } => Boolean(x.doc && x.t))
    .sort((a, b) => String(b.d.decided_at).localeCompare(String(a.d.decided_at))),
  [decisions, doctorsById, trialMap])

  // Контакты: из кэша trial_contacts; если нет — тянем с ClinicalTrials.gov и сохраняем.
  async function refreshContacts(t: Trial) {
    setContactBusy((s) => new Set(s).add(t.id))
    setContactErr((m) => { const n = new Map(m); n.delete(t.id); return n })
    try {
      const row = await adminSaveTrialContacts(t.id, await fetchTrialContacts(t.nct_id))
      setContacts((m) => new Map(m).set(t.id, row))
    } catch (e) {
      setContactErr((m) => new Map(m).set(t.id,
        `Не удалось получить контакты: ${(e as Error).message}. Откройте карточку на ClinicalTrials.gov.`))
    } finally {
      setContactBusy((s) => { const n = new Set(s); n.delete(t.id); return n })
    }
  }

  useEffect(() => {
    if (autoRunning.current) return
    const queue = accepted
      .filter(({ t }) => !contacts.has(t.id) && !autoTried.current.has(t.id))
      .slice(0, 12)
    if (!queue.length) return
    autoRunning.current = true
    ;(async () => {
      for (const { t } of queue) {
        autoTried.current.add(t.id)
        await refreshContacts(t)
        await new Promise((r) => setTimeout(r, 250)) // бережём публичный API
      }
      autoRunning.current = false
    })()
  }, [accepted, contacts])

  // Прокрутка к карточке, открытой из матрицы, и короткая подсветка.
  useEffect(() => {
    if (section !== 'work' || !focusKey) return
    document.getElementById(`work-${focusKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const timer = window.setTimeout(() => setFocusKey(''), 2600)
    return () => window.clearTimeout(timer)
  }, [section, focusKey])

  function openWork(userId: string, trialId: string) {
    setSection('work')
    setFocusKey(`${userId}:${trialId}`)
  }

  async function setStage(d: Decision, stage: WorkStage) {
    setDecisions((prev) => prev.map((x) =>
      x.user_id === d.user_id && x.trial_id === d.trial_id ? { ...x, work_stage: stage } : x))
    try { await adminSetStage(d.user_id, d.trial_id, stage) } catch { loadAll() }
  }

  async function invite() {
    setInviteMsg('')
    try {
      const res = await adminInvite(inviteEmail.trim(), inviteName.trim(), inviteGroup || null) as { group_error?: string | null }
      setInviteMsg(res?.group_error
        ? `Приглашение отправлено на ${inviteEmail.trim()}, но в группу добавить не вышло: ${res.group_error}`
        : `Приглашение отправлено на ${inviteEmail.trim()}`)
      setInviteEmail(''); setInviteName('')
      loadAll()
    } catch (e) {
      setInviteMsg(`Ошибка: ${(e as Error).message}. Запасной путь: Supabase Dashboard → Authentication → Invite user.`)
    }
  }

  async function createGroup() {
    const name = newGroup.trim()
    if (!name) return
    setGroupMsg('')
    try {
      await adminCreateGroup(name)
      setNewGroup('')
      loadAll()
    } catch (e) {
      setGroupMsg(/duplicate|unique/i.test((e as Error).message)
        ? `Группа «${name}» уже есть.`
        : `Ошибка: ${(e as Error).message}`)
    }
  }

  async function renameGroup(g: Group) {
    const name = window.prompt('Новое название группы', g.name)?.trim()
    if (!name || name === g.name) return
    try { await adminRenameGroup(g.id, name); loadAll() }
    catch (e) { setGroupMsg(`Ошибка: ${(e as Error).message}`) }
  }

  async function deleteGroup(g: Group) {
    const n = groupMembers.get(g.id)?.length ?? 0
    const ok = window.confirm(
      `Удалить группу «${g.name}»?\n\nВрачи (${n}) и их решения останутся — пропадёт только общий доступ внутри группы.`)
    if (!ok) return
    try { await adminDeleteGroup(g.id); loadAll() }
    catch (e) { setGroupMsg(`Ошибка: ${(e as Error).message}`) }
  }

  async function addMember(groupId: string, userId: string) {
    if (!userId) return
    try { await adminAddMember(groupId, userId); loadAll() }
    catch (e) { setGroupMsg(`Ошибка: ${(e as Error).message}`) }
  }

  async function removeMember(groupId: string, userId: string) {
    try { await adminRemoveMember(groupId, userId); loadAll() }
    catch (e) { setGroupMsg(`Ошибка: ${(e as Error).message}`) }
  }

  async function toggleField(d: Profile, f: Field) {
    const cur = fieldsOf(d)
    const next = cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]
    if (!next.length) return   // хотя бы одно направление у врача должно быть
    setDoctors((prev) => prev.map((x) => (x.id === d.id ? { ...x, fields: next } : x)))
    try { await adminUpdateDoctor(d.id, { fields: next }) } catch { loadAll() }
  }

  async function toggleActive(d: Profile) {
    await adminUpdateDoctor(d.id, { is_active: !d.is_active })
    loadAll()
  }

  if (loading) return <p className="py-20 text-center text-[13px] text-[var(--muted)]">Загрузка панели…</p>
  if (loadErr) {
    return (
      <div className="card p-6 max-w-xl">
        <div className="text-[15px] font-semibold">Панель не загрузилась</div>
        <p className="text-[13px] text-[var(--muted)] mt-1">{loadErr}</p>
        <button className="btn mt-4" onClick={() => { setLoading(true); loadAll() }}>Повторить</button>
      </div>
    )
  }

  // ------------------------------------------------ данные мониторинга
  const fieldRows = rows.filter((r) => r.section !== 'upcoming' && trialField(r.trial) === field)
  const upcomingCount = rows.filter((r) => r.section === 'upcoming' && trialField(r.trial) === field).length
  const rowsPerField = Object.fromEntries(FIELD_ORDER.map((f) => [
    f, rows.filter((r) => r.section !== 'upcoming' && trialField(r.trial) === f).length,
  ])) as Record<Field, number>

  const fieldDoctors = activeDoctors.filter((d) => d.role === 'admin' || fieldsOf(d).includes(field))
  // Врачи — всегда; админы — только если что-то решали в этом выпуске (или включён показ всех).
  const columns = fieldDoctors
    .filter((d) => d.role !== 'admin' || showAllAdmins || fieldRows.some((r) => cellFor(d.id, r.trial.id)))
    .sort((a, b) => (a.role === b.role
      ? peerName(a).localeCompare(peerName(b), 'ru')
      : a.role === 'doctor' ? -1 : 1))
  const hiddenAdmins = fieldDoctors.filter((d) => d.role === 'admin').length - columns.filter((d) => d.role === 'admin').length

  const acceptCount = (trialId: string) => columns.filter((d) => cellFor(d.id, trialId)?.status === 'accepted').length
  const shownRows = order === 'rank'
    ? fieldRows
    : [...fieldRows].sort((a, b) => acceptCount(b.trial.id) - acceptCount(a.trial.id) || a.rank - b.rank)

  const doctorCols = columns.filter((d) => d.role === 'doctor')
  let decidedCells = 0
  let acceptedCells = 0
  for (const r of fieldRows) {
    for (const d of columns) {
      const c = cellFor(d.id, r.trial.id)
      if (!c) continue
      if (d.role === 'doctor') decidedCells++
      if (c.status === 'accepted') acceptedCells++
    }
  }
  const totalCells = fieldRows.length * doctorCols.length
  const coverage = totalCells ? Math.round((decidedCells / totalCells) * 100) : 0

  const fieldOnlyDoctors = activeDoctors.filter((d) => d.role === 'doctor' && fieldsOf(d).includes(field))
  const online7 = fieldOnlyDoctors.filter((d) => {
    const s = lastSeen.get(d.id)
    return Boolean(s) && Date.now() - new Date(s as string).getTime() < 7 * DAY
  }).length

  const weekPicks = picks
    .filter((e) => {
      const t = new Date(e.created_at).getTime()
      return t >= weekStartMs && t < weekEndMs
    })
    .filter((e) => {
      const t = trialMap.get(e.trial_id)
      return !t || trialField(t) === field
    })
    .slice()
    .reverse()

  const acceptedInField = accepted.filter(({ t }) => trialField(t) === field)
  const acceptedPerField = Object.fromEntries(FIELD_ORDER.map((f) => [
    f, accepted.filter(({ t }) => trialField(t) === f).length,
  ])) as Record<Field, number>

  const sections: { id: Section; label: string; count?: number }[] = [
    { id: 'monitor', label: 'Мониторинг' },
    { id: 'work', label: 'В работе', count: accepted.length },
    { id: 'people', label: 'Врачи и группы', count: activeDoctors.length },
    { id: 'requests', label: 'Заявки' },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* шапка панели */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Панель администратора</div>
          <h1 className="text-[26px] font-semibold mt-1 leading-tight">
            {sections.find((s) => s.id === section)?.label}
          </h1>
        </div>
        <div className="seg" role="tablist" aria-label="Разделы панели">
          {sections.map((s) => (
            <button key={s.id} role="tab" aria-pressed={section === s.id} aria-selected={section === s.id}
              onClick={() => setSection(s.id)} className="flex items-center gap-1.5">
              {s.label}
              {s.count != null && <span className="mono text-[11px] text-[var(--faint)]">{s.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ================================================== МОНИТОРИНГ */}
      {section === 'monitor' && (
        <>
          <button onClick={() => setSection('work')}
            className="card card-hover w-full px-4 py-3.5 flex items-center gap-3.5 text-left"
            style={{ background: 'var(--teal-soft)', borderColor: 'var(--teal-line)' }}>
            <span className="w-10 h-10 rounded-xl grid place-items-center shrink-0" style={{ background: 'var(--teal)', color: '#FFFFFF' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12h4l3 7 4-14 3 7h4" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">
                В работе: {acceptedInField.length} {plural(acceptedInField.length, ['исследование', 'исследования', 'исследований'])} · {FIELDS[field].label}
              </span>
              <span className="block text-[12.5px] text-[var(--muted)]">
                Полные карточки, контакты спонсоров для связи и трек этапов работы
              </span>
            </span>
            <span className="text-[13px] font-semibold shrink-0" style={{ color: 'var(--teal)' }}>Открыть →</span>
          </button>

          <div className="card px-4 py-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="eyebrow">Выпуск</span>
              <select value={weekId} onChange={(e) => setWeekId(e.target.value)} className="input h-9 pr-8">
                {digests.map((d, i) => (
                  <option key={d.id} value={d.id}>
                    {weekLabel(d.week_start)}{i === 0 ? ' · текущий' : ''}
                  </option>
                ))}
              </select>
            </label>
            {!isLatest && week && (
              <span className="chip" style={{ color: 'var(--amber)', borderColor: 'var(--amber-soft)', background: 'var(--amber-soft)' }}>
                история · состояние на конец недели
              </span>
            )}
            <FieldSwitch value={field} onChange={setField} counts={rowsPerField} />
            <div className="seg ml-auto" role="group" aria-label="Порядок строк">
              <button aria-pressed={order === 'rank'} onClick={() => setOrder('rank')}>По выпуску</button>
              <button aria-pressed={order === 'accepted'} onClick={() => setOrder('accepted')}>Сначала принятые</button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Исследований в выпуске" value={fieldRows.length}
              hint={upcomingCount ? `+ ${upcomingCount} будущих` : FIELDS[field].label} accent={FIELD_COLOR[field].fg} />
            <Kpi label="Разобрано врачами" value={`${coverage}%`}
              hint={`${decidedCells} из ${totalCells} решений`} bar={coverage} />
            <Kpi label="Принято" value={acceptedCells} hint="решений «принять» в выпуске" accent="var(--green)" />
            <Kpi label="Врачей онлайн за 7 дней" value={`${online7} / ${fieldOnlyDoctors.length}`}
              hint={FIELDS[field].label} />
          </div>

          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-[var(--line)]">
              <div className="text-[14px] font-semibold">Матрица решений</div>
              <Legend />
              <label className="ml-auto flex items-center gap-2 text-[12px] text-[var(--muted)] cursor-pointer select-none">
                <input type="checkbox" checked={showAllAdmins} onChange={(e) => setShowAllAdmins(e.target.checked)}
                  className="accent-[var(--teal)]" />
                Все администраторы{!showAllAdmins && hiddenAdmins > 0 ? ` (скрыто ${hiddenAdmins})` : ''}
              </label>
            </div>
            <div className="overflow-auto max-h-[68vh]">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="sticky-col min-w-[320px]">Исследование</th>
                    {columns.map((d) => (
                      <th key={d.id} className="text-center min-w-[96px]">
                        <DoctorHead doc={d} seen={lastSeen.get(d.id)} />
                      </th>
                    ))}
                    <th className="text-center">Принято</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsLoading && (
                    <tr><td colSpan={columns.length + 2} className="py-10 text-center text-[var(--muted)]">Загрузка выпуска…</td></tr>
                  )}
                  {!rowsLoading && shownRows.map((r) => {
                    const t = r.trial
                    const n = acceptCount(t.id)
                    return (
                      <tr key={t.id}>
                        <td className="sticky-col max-w-[400px]" style={{ boxShadow: `inset 3px 0 0 ${FIELD_COLOR[field].fg}` }}>
                          <div className="flex items-start gap-3 pl-1">
                            <ScorePill score={t.score} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-[10.5px] text-[var(--faint)]">
                                <span className="mono">{t.nct_id}</span>
                                <span className="truncate">{CATEGORIES[t.category] ?? t.category}</span>
                              </div>
                              <a href={t.source_url} target="_blank" rel="noreferrer" title={t.title}
                                className="block text-[13px] font-medium leading-snug line-clamp-2 hover:text-[var(--teal)]">
                                {t.title_ru || t.title}
                              </a>
                            </div>
                          </div>
                        </td>
                        {columns.map((d) => {
                          const live = decMap.get(`${d.id}:${t.id}`)
                          return (
                            <td key={d.id} className="text-center">
                              <StatusCell cell={cellFor(d.id, t.id)}
                                onOpen={live?.status === 'accepted' ? () => openWork(d.id, t.id) : undefined} />
                            </td>
                          )
                        })}
                        <td className="text-center">
                          <span className="mono text-[13px] font-semibold" style={{ color: n > 0 ? 'var(--green)' : 'var(--faint)' }}>{n}</span>
                        </td>
                      </tr>
                    )
                  })}
                  {!rowsLoading && shownRows.length === 0 && (
                    <tr>
                      <td colSpan={columns.length + 2} className="py-12 text-center text-[var(--muted)]">
                        В этом выпуске нет исследований по направлению «{FIELDS[field].label}».
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="card">
              <div className="flex items-baseline justify-between px-4 py-3 border-b border-[var(--line)]">
                <div className="text-[14px] font-semibold">Лента выборов за неделю</div>
                <span className="mono text-[11px] text-[var(--faint)]">{weekPicks.length}</span>
              </div>
              {weekPicks.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13px] text-[var(--muted)]">За эту неделю выборов не было.</p>
              ) : (
                <ul className="divide-y divide-[var(--line)] max-h-[440px] overflow-auto">
                  {weekPicks.map((e) => {
                    const doc = doctorsById.get(e.user_id)
                    const t = trialMap.get(e.trial_id)
                    const s = STATUS_STYLE[e.status]
                    return (
                      <li key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                        <span className="mt-0.5 w-6 h-6 shrink-0 rounded-md grid place-items-center text-[12px] font-bold"
                          style={{ color: s.fg, background: s.bg }}>{s.icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px]">
                            <span className="font-semibold">{doc ? peerName(doc) : 'Удалённый пользователь'}</span>
                            {' '}<span style={{ color: s.fg }}>{s.verb}</span>
                          </div>
                          <div className="text-[12px] text-[var(--muted)] truncate">
                            <span className="mono text-[11px] text-[var(--faint)]">{t?.nct_id ?? '…'}</span>
                            {' · '}{t ? (t.title_ru || t.title) : 'загрузка…'}
                          </div>
                        </div>
                        <span className="mono text-[11px] text-[var(--faint)] shrink-0 pt-0.5" title={fullStamp(e.created_at)}>
                          {shortStamp(e.created_at)}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="card">
              <div className="px-4 py-3 border-b border-[var(--line)] text-[14px] font-semibold">Кто когда был онлайн</div>
              <ul className="divide-y divide-[var(--line)]">
                {[...fieldOnlyDoctors]
                  .sort((a, b) => String(lastSeen.get(b.id) ?? '').localeCompare(String(lastSeen.get(a.id) ?? '')))
                  .map((d) => {
                    const seen = lastSeen.get(d.id)
                    return (
                      <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                        <OnlineDot seen={seen} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] font-medium truncate">{peerName(d)}</div>
                          <div className="text-[11px] text-[var(--faint)] truncate">{d.email}</div>
                        </div>
                        <span className="text-[11.5px] text-[var(--muted)] shrink-0" title={fullStamp(seen)}>{timeAgo(seen)}</span>
                      </li>
                    )
                  })}
                {fieldOnlyDoctors.length === 0 && (
                  <li className="px-4 py-6 text-center text-[13px] text-[var(--muted)]">Нет врачей с доступом к направлению.</li>
                )}
              </ul>
            </div>
          </div>
        </>
      )}

      {/* ================================================== В РАБОТЕ */}
      {section === 'work' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <FieldSwitch value={field} onChange={setField} counts={acceptedPerField} />
            <p className="text-[12.5px] text-[var(--muted)] max-w-[60ch]">
              Контакты — внутри каждой карточки, раздел «Контакты спонсора». Этап работы меняется
              кликом по точке на треке; врач видит тот же трек у себя.
            </p>
          </div>
          {acceptedInField.length === 0 && (
            <div className="card px-6 py-12 text-center text-[13px] text-[var(--muted)]">
              По направлению «{FIELDS[field].label}» пока ничего не принято.
            </div>
          )}
          <div className="flex flex-col gap-4">
            {acceptedInField.map(({ d, doc, t }) => {
              const key = `${d.user_id}:${d.trial_id}`
              return (
              <div key={key} id={`work-${key}`} style={{ scrollMarginTop: 84 }}
                className={`rounded-[20px] transition-shadow duration-500 ${focusKey === key ? 'ring-2 ring-[var(--teal-bright)] ring-offset-4 ring-offset-[var(--bg)]' : ''}`}>
              <TrialCard
                trial={t}
                mode="readonly"
                defaultOpen
                badge={
                  <span className="chip" style={{ background: 'var(--teal-soft)', color: 'var(--teal)', borderColor: 'var(--teal-line)' }}
                    title={`${doc.email} · принято ${fullStamp(d.decided_at)}`}>
                    <span className="font-semibold">{peerName(doc)}</span>
                    <span className="opacity-70">· {timeAgo(d.decided_at)}</span>
                  </span>
                }
                body={
                  <div className="flex flex-col gap-2.5">
                    <StageTracker stage={d.work_stage} editable onSetStage={(s) => setStage(d, s)} />
                    {d.note && (
                      <p className="text-[12.5px] rounded-xl px-3 py-2.5 leading-relaxed"
                        style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
                        <span className="text-[var(--muted)]">Заметка врача: </span>
                        {d.note}
                      </p>
                    )}
                  </div>
                }
                details={
                  <ContactPanel
                    trial={t}
                    contacts={contacts.get(t.id)}
                    refreshing={contactBusy.has(t.id)}
                    error={contactErr.get(t.id)}
                    onRefresh={() => refreshContacts(t)}
                  />
                }
              />
              </div>
              )
            })}
          </div>
        </>
      )}

      {/* ================================================== ВРАЧИ И ГРУППЫ */}
      {section === 'people' && (
        <>
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--line)] flex items-baseline justify-between">
              <div className="text-[14px] font-semibold">Врачи</div>
              <span className="text-[12px] text-[var(--faint)]">{activeDoctors.length} активных из {doctors.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Врач</th>
                    <th>Направления</th>
                    <th>Группы</th>
                    <th>Онлайн</th>
                    <th className="text-center">Выборов за 7 дн.</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {doctors.map((d) => {
                    const seen = lastSeen.get(d.id)
                    const gs = groupsOfDoctor.get(d.id) ?? []
                    return (
                      <tr key={d.id} style={{ opacity: d.is_active ? 1 : 0.55 }}>
                        <td className="min-w-[220px]">
                          <div className="flex items-center gap-2.5">
                            <Avatar p={d} />
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium flex items-center gap-1.5">
                                {d.full_name || '—'}
                                {d.role === 'admin' && <span className="mono text-[9.5px] px-1.5 py-px rounded" style={{ background: 'var(--teal-soft)', color: 'var(--teal)' }}>ADMIN</span>}
                              </div>
                              <div className="mono text-[11px] text-[var(--faint)] truncate">{d.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {d.role === 'admin' ? (
                            <span className="text-[12px] text-[var(--faint)]">все</span>
                          ) : (
                            <div className="flex gap-1">
                              {FIELD_ORDER.map((f) => {
                                const on = fieldsOf(d).includes(f)
                                return (
                                  <button key={f} onClick={() => toggleField(d, f)} title={on ? 'Закрыть доступ' : 'Открыть доступ'}
                                    className="chip transition-colors"
                                    style={on
                                      ? { borderColor: FIELD_COLOR[f].fg, color: FIELD_COLOR[f].fg, background: FIELD_COLOR[f].bg }
                                      : undefined}>
                                    {on ? '✓ ' : ''}{FIELDS[f].label}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </td>
                        <td className="text-[12px]">
                          {gs.length
                            ? <span style={{ color: 'var(--teal)' }}>{gs.join(', ')}</span>
                            : <span className="text-[var(--faint)]">без группы</span>}
                        </td>
                        <td className="whitespace-nowrap">
                          <span className="inline-flex items-center gap-2 text-[12px] text-[var(--muted)]" title={fullStamp(seen)}>
                            <OnlineDot seen={seen} />{timeAgo(seen)}
                          </span>
                        </td>
                        <td className="text-center mono text-[12.5px]">{picks7.get(d.id) ?? 0}</td>
                        <td className="text-right">
                          <button onClick={() => toggleActive(d)} className="btn btn-ghost btn-sm"
                            style={{ color: d.is_active ? 'var(--red)' : 'var(--green)' }}>
                            {d.is_active ? 'Деактивировать' : 'Активировать'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5 flex flex-col gap-3">
              <div>
                <div className="text-[14px] font-semibold">Пригласить врача</div>
                <p className="text-[12px] text-[var(--muted)] mt-0.5">Придёт письмо со ссылкой; после первого входа врач появится в таблице.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Имя Фамилия" className="input" />
                <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="email@clinic.by" className="input" />
                <select value={inviteGroup} onChange={(e) => setInviteGroup(e.target.value)} className="input">
                  <option value="">без группы</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <button onClick={invite} disabled={!inviteEmail.includes('@')} className="btn btn-primary">Пригласить</button>
              </div>
              {inviteMsg && <span className="text-[12px] text-[var(--muted)]">{inviteMsg}</span>}
            </div>

            <div className="card p-5 flex flex-col gap-3">
              <div>
                <div className="text-[14px] font-semibold">Новая группа</div>
                <p className="text-[12px] text-[var(--muted)] mt-0.5">
                  Врачи одной группы видят решения, этапы и заметки друг друга. Менять чужие решения может только администратор.
                </p>
              </div>
              <div className="flex gap-2">
                <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') createGroup() }}
                  placeholder="Например: Аритмология" className="input flex-1" />
                <button onClick={createGroup} disabled={!newGroup.trim()} className="btn btn-primary">Создать</button>
              </div>
              {groupMsg && <span className="text-[12px] text-[var(--muted)]">{groupMsg}</span>}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="eyebrow">Группы врачей</div>
            {groups.length === 0 && <p className="text-[13px] text-[var(--muted)]">Групп пока нет.</p>}
            <div className="grid gap-3 md:grid-cols-2">
              {groups.map((g) => {
                const inGroup = groupMembers.get(g.id) ?? []
                const outside = doctors.filter((d) => !inGroup.some((m) => m.id === d.id))
                return (
                  <div key={g.id} className="card p-4 flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-[14px] font-semibold">{g.name}</span>
                      <span className="mono text-[11px] text-[var(--faint)]">{inGroup.length} чел.</span>
                      <button onClick={() => renameGroup(g)} className="ml-auto btn btn-ghost btn-sm">Переименовать</button>
                      <button onClick={() => deleteGroup(g)} className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }}>Удалить</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {inGroup.map((m) => (
                        <span key={m.id} className="chip pr-1" style={{ color: m.is_active ? 'var(--text)' : 'var(--faint)' }}>
                          {peerName(m)}
                          {m.role === 'admin' && <span className="mono text-[9px]" style={{ color: 'var(--teal)' }}>ADMIN</span>}
                          <button onClick={() => removeMember(g.id, m.id)} title="Убрать из группы" aria-label={`Убрать ${peerName(m)} из группы`}
                            className="w-4 h-4 leading-none rounded-full hover:bg-[var(--sunken)] text-[var(--faint)]">×</button>
                        </span>
                      ))}
                      {inGroup.length === 0 && <span className="text-[12px] text-[var(--faint)]">Пока никого.</span>}
                    </div>
                    {outside.length > 0 && (
                      <select value="" onChange={(e) => addMember(g.id, e.target.value)} className="input h-9 self-start text-[12px]">
                        <option value="">+ Добавить врача…</option>
                        {outside.map((d) => <option key={d.id} value={d.id}>{peerName(d)} — {d.email}</option>)}
                      </select>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* ================================================== ЗАЯВКИ */}
      {section === 'requests' && <ExpansionAdmin doctors={doctors} onGroupsChanged={loadAll} />}
    </div>
  )
}

// ================================================================ мелкие компоненты

function FieldSwitch({ value, onChange, counts }: { value: Field; onChange: (f: Field) => void; counts?: Record<Field, number> }) {
  return (
    <div className="seg" role="group" aria-label="Направление">
      {FIELD_ORDER.map((f) => (
        <button key={f} aria-pressed={value === f} onClick={() => onChange(f)} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: FIELD_COLOR[f].fg }} />
          {FIELDS[f].label}
          {counts && <span className="mono text-[11px] text-[var(--faint)]">{counts[f]}</span>}
        </button>
      ))}
    </div>
  )
}

function Kpi({ label, value, hint, accent, bar }: {
  label: string; value: React.ReactNode; hint?: string; accent?: string; bar?: number
}) {
  return (
    <div className="card px-4 py-3.5 flex flex-col gap-1">
      <div className="eyebrow">{label}</div>
      <div className="mono text-[24px] font-semibold leading-none mt-1" style={accent ? { color: accent } : undefined}>{value}</div>
      {bar != null && (
        <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: 'var(--sunken)' }}>
          <div className="h-full rounded-full track-fill" style={{ width: `${Math.min(100, bar)}%`, background: 'var(--teal)' }} />
        </div>
      )}
      {hint && <div className="text-[11.5px] text-[var(--faint)] mt-1">{hint}</div>}
    </div>
  )
}

function ScorePill({ score }: { score: number | null }) {
  if (score == null) return <span className="w-9 shrink-0" />
  return (
    <span className="mono shrink-0 inline-flex items-center justify-center w-9 h-6 rounded-md text-[11.5px] font-semibold"
      style={{ color: '#FFFFFF', background: scoreColor(score) }} title={`Балл радара ${score}`}>
      {score}
    </span>
  )
}

function StatusCell({ cell, onOpen }: { cell: Cell | null; onOpen?: () => void }) {
  if (!cell) return <span className="text-[var(--line-strong)]">—</span>
  const s = STATUS_STYLE[cell.status]
  const title = [
    STATUS_LABEL[cell.status],
    fullStamp(cell.at),
    cell.status === 'accepted' && cell.stage ? `этап: ${STAGES[cell.stage]}` : '',
    onOpen ? 'нажмите — карточка, контакты и этапы' : '',
  ].filter(Boolean).join(' · ')
  const inner = (
    <>
      <span className="inline-flex items-center justify-center h-6 min-w-[26px] px-1.5 rounded-md text-[12px] font-bold"
        style={{ color: s.fg, background: s.bg }}>
        {s.icon}
      </span>
      <span className="mono text-[10px] text-[var(--faint)] whitespace-nowrap">{shortStamp(cell.at)}</span>
      {cell.status === 'accepted' && cell.stage && cell.stage !== 'interest' && (
        <span className="text-[9.5px] font-medium whitespace-nowrap" style={{ color: 'var(--teal)' }}>{STAGES[cell.stage]}</span>
      )}
    </>
  )
  if (!onOpen) return <span className="inline-flex flex-col items-center gap-1" title={title}>{inner}</span>
  return (
    <button type="button" onClick={onOpen} title={title}
      className="inline-flex flex-col items-center gap-1 rounded-lg px-2 py-1 -my-1 transition-colors hover:bg-[var(--green-soft)] cursor-pointer">
      {inner}
    </button>
  )
}

function DoctorHead({ doc, seen }: { doc: Profile; seen?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 normal-case tracking-normal"
      title={`${doc.email}${seen ? ` · последняя активность ${fullStamp(seen)}` : ''}`}>
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text)] max-w-[120px]">
        <OnlineDot seen={seen} />
        <span className="truncate">{shortName(doc)}</span>
      </span>
      <span className="text-[10.5px] font-normal text-[var(--faint)] whitespace-nowrap">
        {doc.role === 'admin' ? 'админ · ' : ''}{timeAgo(seen)}
      </span>
    </div>
  )
}

function OnlineDot({ seen }: { seen?: string }) {
  const now = isRecent(seen, 15)
  const week = !now && Boolean(seen) && Date.now() - new Date(seen as string).getTime() < 7 * DAY
  return (
    <span className="w-2 h-2 rounded-full shrink-0" aria-hidden="true"
      style={{ background: now ? 'var(--green)' : week ? 'var(--teal-line)' : 'var(--line-strong)' }} />
  )
}

function Avatar({ p }: { p: Profile }) {
  const letter = (p.full_name || p.email).trim().slice(0, 1).toUpperCase()
  return (
    <span className="w-8 h-8 rounded-full grid place-items-center text-[12.5px] font-semibold shrink-0"
      style={{ background: 'var(--sunken)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
      {letter}
    </span>
  )
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[11.5px] text-[var(--muted)]">
      {(Object.keys(STATUS_STYLE) as DecisionStatus[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-md grid place-items-center text-[11px] font-bold"
            style={{ color: STATUS_STYLE[k].fg, background: STATUS_STYLE[k].bg }}>{STATUS_STYLE[k].icon}</span>
          {STATUS_LABEL[k]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5"><span className="text-[var(--line-strong)]">—</span>нет решения</span>
    </div>
  )
}
