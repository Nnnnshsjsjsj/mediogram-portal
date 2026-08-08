import { useEffect, useMemo, useRef, useState } from 'react'
import TrialCard from '../components/TrialCard'
import { clearDecision, decide, getLatestTrials, getMyDecisions, getMyWatches, logEvent, toggleWatch } from '../lib/api'
import type { Decision, DecisionStatus, Profile, Trial } from '../lib/types'
import { CATEGORIES } from '../lib/types'

type SubTab = 'current' | 'upcoming'

export default function TriageScreen({ profile }: { profile: Profile }) {
  const [trials, setTrials] = useState<Trial[]>([])
  const [weekStart, setWeekStart] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map())
  const [watches, setWatches] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<SubTab>('current')
  const [catFilter, setCatFilter] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set())
  const [countryFilter, setCountryFilter] = useState<Set<string>>(new Set())
  const [sortBy, setSortBy] = useState<'score' | 'fresh'>('score')
  const [undo, setUndo] = useState<{ trialId: string; prev: Decision | undefined } | null>(null)
  const undoTimer = useRef<number | null>(null)

  useEffect(() => {
    ;(async () => {
      const [{ weekStart, trials }, ds, ws] = await Promise.all([
        getLatestTrials(), getMyDecisions(), getMyWatches(),
      ])
      setWeekStart(weekStart)
      setTrials(trials)
      setDecisions(new Map(ds.map((d) => [d.trial_id, d])))
      setWatches(ws)
      setLoading(false)
      logEvent('digest_view', { week: weekStart })
    })()
  }, [])

  // Подписки врача: пустой массив = все категории.
  const subscribed = useMemo(
    () => (profile.categories.length ? new Set(profile.categories) : null),
    [profile.categories],
  )

  const visible = useMemo(() => {
    const filtered = trials.filter((t) => {
      if (subscribed && !subscribed.has(t.category)) return false
      if (tab === 'current' ? t.is_upcoming : !t.is_upcoming) return false
      if (catFilter.size && !catFilter.has(t.category)) return false
      if (statusFilter.size && !statusFilter.has(t.recruitment_status)) return false
      if (countryFilter.size && !t.countries.some((c) => countryFilter.has(c))) return false
      return true
    })
    return [...filtered].sort((a, b) => {
      if (sortBy === 'score') {
        const d = (b.score ?? -1) - (a.score ?? -1)
        if (d !== 0) return d
      }
      return String(b.first_posted ?? b.first_seen_at).localeCompare(String(a.first_posted ?? a.first_seen_at))
    })
  }, [trials, subscribed, tab, catFilter, statusFilter, countryFilter, sortBy])

  const availableCountries = useMemo(() => {
    const freq = new Map<string, number>()
    for (const t of trials) for (const c of t.countries) freq.set(c, (freq.get(c) ?? 0) + 1)
    return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c)
  }, [trials])

  const pending = visible.filter((t) => !decisions.has(t.id))
  const done = visible.length - pending.length

  const availableStatuses = useMemo(
    () => [...new Set(trials.map((t) => t.recruitment_status).filter(Boolean))],
    [trials],
  )

  async function handleDecide(trial: Trial, status: DecisionStatus) {
    const prev = decisions.get(trial.id)
    // optimistic
    const next = new Map(decisions)
    next.set(trial.id, {
      user_id: profile.id, trial_id: trial.id, status,
      work_stage: status === 'accepted' ? 'interest' : null,
      note: null, decided_at: new Date().toISOString(),
    })
    setDecisions(next)
    setUndo({ trialId: trial.id, prev })
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setUndo(null), 5000)
    try { await decide(trial.id, status) } catch {
      const rollback = new Map(next)
      prev ? rollback.set(trial.id, prev) : rollback.delete(trial.id)
      setDecisions(rollback)
    }
  }

  async function handleUndo() {
    if (!undo) return
    const { trialId, prev } = undo
    setUndo(null)
    const next = new Map(decisions)
    prev ? next.set(trialId, prev) : next.delete(trialId)
    setDecisions(next)
    try {
      if (prev) await decide(trialId, prev.status)
      else await clearDecision(trialId)
    } catch { /* перезагрузка страницы восстановит истину из БД */ }
  }

  async function handleWatch(trial: Trial, on: boolean) {
    const next = new Set(watches)
    on ? next.add(trial.id) : next.delete(trial.id)
    setWatches(next)
    try { await toggleWatch(trial.id, on) } catch { setWatches(watches) }
  }

  if (loading) return <Centered>Загрузка выпуска…</Centered>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold">Триаж исследований</h1>
          <p className="mono text-[11px] text-[var(--muted)]">
            {weekStart ? `Выпуск недели ${weekStart}` : 'Актуальная лента'}
          </p>
        </div>
        <div className="flex rounded-xl border border-[var(--line)] overflow-hidden">
          {(['current', 'upcoming'] as SubTab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className="px-4 py-2 text-[13px] font-medium transition-colors"
              style={tab === t ? { background: 'var(--teal)', color: 'var(--on-accent)' } : { color: 'var(--muted)' }}>
              {t === 'current' ? 'Актуальные' : 'Будущие'}
            </button>
          ))}
        </div>
      </div>

      {/* Фильтры */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(CATEGORIES)
          .filter(([k]) => !subscribed || subscribed.has(k))
          .filter(([k]) => trials.some((t) => t.category === k))
          .map(([k, label]) => (
          <Chip key={k} label={label} active={catFilter.has(k)}
            onClick={() => setCatFilter(toggleSet(catFilter, k))} />
        ))}
        <span className="w-px bg-[var(--line)] mx-1 self-stretch" />
        {availableStatuses.map((s) => (
          <Chip key={s} label={s} active={statusFilter.has(s)} mono
            onClick={() => setStatusFilter(toggleSet(statusFilter, s))} />
        ))}
        <span className="w-px bg-[var(--line)] mx-1 self-stretch" />
        {availableCountries.map((c) => (
          <Chip key={c} label={c} active={countryFilter.has(c)}
            onClick={() => setCountryFilter(toggleSet(countryFilter, c))} />
        ))}
        <span className="w-px bg-[var(--line)] mx-1 self-stretch" />
        <Chip label={sortBy === 'score' ? '↓ по баллу' : '↓ по свежести'} active
          onClick={() => setSortBy(sortBy === 'score' ? 'fresh' : 'score')} />
      </div>

      {tab === 'current' && visible.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${visible.length ? (done / visible.length) * 100 : 0}%`, background: 'var(--teal)' }} />
          </div>
          <span className="mono text-[11px] text-[var(--muted)]">Разобрано {done} из {visible.length}</span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {tab === 'current' && pending.map((t, i) => (
          <div key={t.id} className={`rise rise-${Math.min(i + 1, 6)}`}>
            <TrialCard trial={t} mode="triage" decision={decisions.get(t.id)}
              onDecide={(s) => handleDecide(t, s)} />
          </div>
        ))}
        {tab === 'upcoming' && visible.map((t, i) => (
          <div key={t.id} className={`rise rise-${Math.min(i + 1, 6)}`}>
            <TrialCard trial={t} mode="upcoming" watched={watches.has(t.id)}
              onToggleWatch={(on) => handleWatch(t, on)} />
          </div>
        ))}
        {tab === 'current' && pending.length === 0 && (
          <Centered>{visible.length ? 'Все исследования недели разобраны 🎉' : 'В этом выпуске нет исследований по вашим фильтрам.'}</Centered>
        )}
        {tab === 'upcoming' && visible.length === 0 && (
          <Centered>Будущих исследований по вашим фильтрам пока нет.</Centered>
        )}
      </div>

      {undo && (
        <div className="fixed bottom-5 left-1/2 z-50 flex items-center gap-3 toast-in
                        rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-2.5"
             style={{ boxShadow: 'var(--shadow-lift)' }}>
          <span className="text-[13px]">Решение сохранено</span>
          <button onClick={handleUndo} className="text-[13px] font-semibold text-[var(--teal)]">Отменить</button>
        </div>
      )}
    </div>
  )
}

function toggleSet(s: Set<string>, k: string): Set<string> {
  const n = new Set(s)
  n.has(k) ? n.delete(k) : n.add(k)
  return n
}

function Chip({ label, active, onClick, mono }: { label: string; active: boolean; onClick: () => void; mono?: boolean }) {
  return (
    <button onClick={onClick}
      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${mono ? 'mono' : ''}`}
      style={active
        ? { borderColor: 'var(--teal)', color: 'var(--teal)', background: 'rgba(0,194,199,0.08)' }
        : { borderColor: 'var(--line)', color: 'var(--muted)' }}>
      {label}
    </button>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="py-16 text-center text-[13px] text-[var(--muted)]">{children}</div>
}
