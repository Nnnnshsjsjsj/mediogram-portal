import { useEffect, useMemo, useState } from 'react'
import { getLatestTrials, getMyDecisions, setStage, decide, clearDecision } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { Decision, DecisionStatus, Trial, WorkStage } from '../lib/types'
import { CATEGORIES, STAGES, STAGE_ORDER } from '../lib/types'

type Seg = DecisionStatus

export default function DecisionsScreen() {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [trials, setTrials] = useState<Map<string, Trial>>(new Map())
  const [seg, setSeg] = useState<Seg>('accepted')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const ds = await getMyDecisions()
      setDecisions(ds)
      // Подтягиваем все trials, по которым есть решения (могут быть из прошлых выпусков).
      const ids = ds.map((d) => d.trial_id)
      const map = new Map<string, Trial>()
      if (ids.length) {
        const { data } = await supabase.from('trials').select('*').in('id', ids)
        for (const t of (data ?? []) as Trial[]) map.set(t.id, t)
      } else {
        const { trials } = await getLatestTrials()
        for (const t of trials) map.set(t.id, t)
      }
      setTrials(map)
      setLoading(false)
    })()
  }, [])

  const bySeg = useMemo(() => decisions.filter((d) => d.status === seg), [decisions, seg])
  const counts = useMemo(() => ({
    accepted: decisions.filter((d) => d.status === 'accepted').length,
    deferred: decisions.filter((d) => d.status === 'deferred').length,
    rejected: decisions.filter((d) => d.status === 'rejected').length,
  }), [decisions])

  async function changeStage(d: Decision, stage: WorkStage) {
    setDecisions((prev) => prev.map((x) => x.trial_id === d.trial_id ? { ...x, work_stage: stage } : x))
    try { await setStage(d.trial_id, stage) } catch { /* обновление страницы вернёт истину */ }
  }

  async function changeStatus(d: Decision, status: DecisionStatus) {
    setDecisions((prev) => prev.map((x) => x.trial_id === d.trial_id
      ? { ...x, status, work_stage: status === 'accepted' ? 'interest' : null } : x))
    try { await decide(d.trial_id, status) } catch { /* no-op */ }
  }

  async function remove(d: Decision) {
    setDecisions((prev) => prev.filter((x) => x.trial_id !== d.trial_id))
    try { await clearDecision(d.trial_id) } catch { /* no-op */ }
  }

  if (loading) return <p className="py-16 text-center text-[13px] text-[var(--muted)]">Загрузка…</p>

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Мои решения</h1>

      <div className="flex rounded-xl border border-[var(--line)] overflow-hidden self-start">
        {([['accepted', `Принятые · ${counts.accepted}`],
           ['deferred', `Отложенные · ${counts.deferred}`],
           ['rejected', `Отклонённые · ${counts.rejected}`]] as [Seg, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setSeg(k)}
            className="px-3.5 py-2 text-[12px] font-medium transition-colors"
            style={seg === k ? { background: 'var(--teal)', color: '#040810' } : { color: 'var(--muted)' }}>
            {label}
          </button>
        ))}
      </div>

      {bySeg.length === 0 && (
        <p className="py-12 text-center text-[13px] text-[var(--muted)]">Здесь пока пусто.</p>
      )}

      <div className="flex flex-col gap-3">
        {bySeg.map((d) => {
          const t = trials.get(d.trial_id)
          if (!t) return null
          return (
            <article key={d.trial_id} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 flex flex-col gap-3">
              <header className="flex flex-wrap items-center gap-2">
                <span className="mono text-[11px] text-[var(--muted)]">{t.nct_id}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--line)] text-[var(--muted)]">
                  {CATEGORIES[t.category] ?? t.category}
                </span>
                <a href={t.source_url} target="_blank" rel="noreferrer"
                  className="text-[11px] text-[var(--teal)] hover:underline ml-auto">CT.gov ↗</a>
              </header>
              <h3 className="text-[14px] font-semibold leading-snug">{t.title_ru || t.title}</h3>

              {seg === 'accepted' && (
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Этап работы</span>
                  <div className="flex flex-wrap gap-1.5">
                    {STAGE_ORDER.map((s, i) => {
                      const activeIdx = STAGE_ORDER.indexOf(d.work_stage ?? 'interest')
                      const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'todo'
                      return (
                        <button key={s} onClick={() => changeStage(d, s)}
                          className="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
                          style={
                            state === 'active' ? { borderColor: 'var(--teal)', color: '#040810', background: 'var(--teal)' }
                            : state === 'done' ? { borderColor: 'var(--teal)', color: 'var(--teal)' }
                            : { borderColor: 'var(--line)', color: 'var(--muted)' }}>
                          {STAGES[s]}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <footer className="flex gap-2 flex-wrap text-[12px]">
                {seg !== 'accepted' && (
                  <ActionLink onClick={() => changeStatus(d, 'accepted')} color="var(--green)">Принять</ActionLink>
                )}
                {seg !== 'deferred' && (
                  <ActionLink onClick={() => changeStatus(d, 'deferred')} color="var(--amber)">Отложить</ActionLink>
                )}
                {seg !== 'rejected' && (
                  <ActionLink onClick={() => changeStatus(d, 'rejected')} color="var(--red)">Отклонить</ActionLink>
                )}
                <ActionLink onClick={() => remove(d)} color="var(--muted)">Убрать решение</ActionLink>
              </footer>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function ActionLink({ children, onClick, color }: { children: React.ReactNode; onClick: () => void; color: string }) {
  return (
    <button onClick={onClick} className="hover:underline" style={{ color }}>{children}</button>
  )
}
