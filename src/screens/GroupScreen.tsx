import { useEffect, useMemo, useState } from 'react'
import { getGroupDecisions, getGroupPeers, getLatestTrials, getMyGroups, logEvent } from '../lib/api'
import { supabase } from '../lib/supabase'
import StageTracker from '../components/StageTracker'
import type { Decision, Group, Peer, Profile, Trial } from '../lib/types'
import { CATEGORIES, STAGES, STATUS_GLYPH, STATUS_LABEL, peerName, trialField, userFields } from '../lib/types'

export default function GroupScreen({ profile }: { profile: Profile }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [groupId, setGroupId] = useState<string | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [trials, setTrials] = useState<Map<string, Trial>>(new Map())
  const [digestIds, setDigestIds] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Список групп врача — грузим один раз.
  useEffect(() => {
    ;(async () => {
      const gs = await getMyGroups()
      setGroups(gs)
      setGroupId(gs[0]?.id ?? null)
      if (!gs.length) setLoading(false)
    })()
  }, [])

  // Состав и решения выбранной группы.
  useEffect(() => {
    if (!groupId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const ps = await getGroupPeers(groupId)
      const ds = await getGroupDecisions(ps.map((p) => p.id))

      // Исследования текущего выпуска + всё, по чему группа уже решала.
      // Только направления, доступные зрителю: кардиологу не нужна онкологическая подборка.
      const mine = userFields(profile)
      const digestTrials = (await getLatestTrials()).trials.filter((t) => mine.includes(trialField(t)))
      const map = new Map<string, Trial>()
      for (const t of digestTrials) map.set(t.id, t)
      const missing = [...new Set(ds.map((d) => d.trial_id))].filter((id) => !map.has(id))
      if (missing.length) {
        const { data } = await supabase.from('trials').select('*').in('id', missing)
        for (const t of (data ?? []) as Trial[]) map.set(t.id, t)
      }

      if (cancelled) return
      setPeers(ps)
      setDecisions(ds)
      setTrials(map)
      setDigestIds(digestTrials.filter((t) => !t.is_upcoming).map((t) => t.id))
      setSelected(null)
      setLoading(false)
      logEvent('group_view', { group_id: groupId })
    })()
    return () => { cancelled = true }
  }, [groupId])

  const decMap = useMemo(() => {
    const m = new Map<string, Decision>()
    for (const d of decisions) m.set(`${d.user_id}:${d.trial_id}`, d)
    return m
  }, [decisions])

  // Строки матрицы: сначала текущий выпуск, затем более старые исследования,
  // по которым у кого-то в группе уже есть решение.
  const rows = useMemo(() => {
    const inDigest = digestIds.filter((id) => trials.has(id))
    const extra = [...new Set(decisions.map((d) => d.trial_id))]
      .filter((id) => trials.has(id) && !digestIds.includes(id))
    return [...inDigest, ...extra].map((id) => trials.get(id)!)
  }, [digestIds, decisions, trials])

  const stats = useMemo(() => {
    const decidedTrials = new Set(decisions.map((d) => d.trial_id))
    const acceptedTrials = new Set(decisions.filter((d) => d.status === 'accepted').map((d) => d.trial_id))
    const mine = new Set(decisions.filter((d) => d.user_id === profile.id).map((d) => d.trial_id))
    return {
      peers: peers.length,
      covered: digestIds.filter((id) => decidedTrials.has(id)).length,
      accepted: acceptedTrials.size,
      myPending: digestIds.filter((id) => !mine.has(id)).length,
    }
  }, [decisions, peers, digestIds, profile.id])

  const notes = useMemo(
    () => decisions
      .filter((d) => d.note && d.note.trim())
      .sort((a, b) => b.decided_at.localeCompare(a.decided_at))
      .slice(0, 20),
    [decisions],
  )

  if (!groups.length && !loading) {
    return (
      <div className="py-16 text-center text-[13px] text-[var(--muted)]">
        Вы пока не состоите ни в одной группе.<br />
        Администратор Mediogram может добавить вас в группу коллег.
      </div>
    )
  }

  if (loading) return <p className="py-16 text-center text-[13px] text-[var(--muted)]">Загрузка группы…</p>

  const group = groups.find((g) => g.id === groupId)
  const sel = selected ? trials.get(selected) : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold">Группа{group ? ` · ${group.name}` : ''}</h1>
          <p className="text-[12px] text-[var(--muted)]">
            Решения коллег видны только внутри группы. Изменить чужое решение нельзя.
          </p>
        </div>
        {groups.length > 1 && (
          <div className="flex rounded-xl border border-[var(--line)] overflow-hidden">
            {groups.map((g) => (
              <button key={g.id} onClick={() => setGroupId(g.id)}
                className="px-3.5 py-2 text-[12px] font-medium transition-colors"
                style={g.id === groupId ? { background: 'var(--teal)', color: 'var(--on-accent)' } : { color: 'var(--muted)' }}>
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Врачей в группе" value={stats.peers} />
        <Metric label="Разобрано в выпуске" value={`${stats.covered} / ${digestIds.length}`} />
        <Metric label="Принято хотя бы одним" value={stats.accepted} />
        <Metric label="Осталось лично вам" value={stats.myPending} />
      </div>

      {/* Матрица решений группы */}
      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold">Кто что решил</h2>
        <p className="text-[12px] text-[var(--muted)]">Нажмите на строку, чтобы увидеть этапы и заметки коллег.</p>
        <div className="overflow-x-auto rounded-2xl border border-[var(--line)]">
          <table className="min-w-full text-[12px]">
            <thead>
              <tr className="bg-[var(--panel)]">
                <th className="text-left px-3 py-2.5 font-medium text-[var(--muted)] sticky left-0 bg-[var(--panel)]">
                  Исследование
                </th>
                {peers.map((p) => (
                  <th key={p.id} className="px-2 py-2.5 font-medium whitespace-nowrap"
                    style={{ color: p.id === profile.id ? 'var(--teal)' : 'var(--muted)' }}>
                    {p.id === profile.id ? 'Вы' : peerName(p)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const isSel = selected === t.id
                return (
                  <tr key={t.id}
                    onClick={() => setSelected(isSel ? null : t.id)}
                    className="border-t border-[var(--line)] cursor-pointer"
                    style={isSel ? { background: 'var(--teal-soft)' } : undefined}>
                    <td className="px-3 py-2 sticky left-0 max-w-[280px]"
                      style={{ background: isSel ? 'var(--teal-soft)' : 'var(--card)' }}>
                      <span className="mono text-[10px] text-[var(--muted)] block">{t.nct_id}</span>
                      <span className="line-clamp-1">{t.title_ru || t.title}</span>
                    </td>
                    {peers.map((p) => {
                      const d = decMap.get(`${p.id}:${t.id}`)
                      const hint = d
                        ? [STATUS_LABEL[d.status], d.work_stage ? STAGES[d.work_stage] : null, d.note ? '· есть заметка' : null]
                            .filter(Boolean).join(' ')
                        : 'Ещё не решено'
                      return (
                        <td key={p.id} title={hint} className="px-2 py-2 text-center">
                          {d ? STATUS_GLYPH[d.status] : '·'}
                          {d?.note ? <span className="text-[10px] align-super text-[var(--muted)]">✎</span> : null}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td className="px-3 py-6 text-center text-[var(--muted)]" colSpan={peers.length + 1}>
                    Выпуск ещё не сформирован, решений в группе пока нет.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Детали по выбранному исследованию */}
      {sel && (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 flex flex-col gap-4">
          <header className="flex flex-wrap items-center gap-2">
            <span className="mono text-[11px] text-[var(--muted)]">{sel.nct_id}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--line)] text-[var(--muted)]">
              {CATEGORIES[sel.category] ?? sel.category}
            </span>
            <a href={sel.source_url} target="_blank" rel="noreferrer"
              className="text-[11px] text-[var(--teal)] hover:underline ml-auto">CT.gov ↗</a>
          </header>
          <h3 className="text-[14px] font-semibold leading-snug">{sel.title_ru || sel.title}</h3>

          <div className="flex flex-col gap-3">
            {peers.map((p) => {
              const d = decMap.get(`${p.id}:${sel.id}`)
              return (
                <div key={p.id} className="rounded-xl border border-[var(--line)] px-3.5 py-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-medium">
                      {p.id === profile.id ? 'Вы' : peerName(p)}
                    </span>
                    {d ? (
                      <span className="text-[12px]">{STATUS_GLYPH[d.status]} {STATUS_LABEL[d.status]}</span>
                    ) : (
                      <span className="text-[12px] text-[var(--muted)]">ещё не решено</span>
                    )}
                    <span className="mono text-[10px] text-[var(--muted)] ml-auto">
                      {d ? new Date(d.decided_at).toLocaleDateString('ru-RU') : ''}
                    </span>
                  </div>
                  {d?.status === 'accepted' && <StageTracker stage={d.work_stage} />}
                  {d?.note && (
                    <p className="text-[12px] leading-relaxed whitespace-pre-line rounded-lg px-3 py-2"
                      style={{ background: 'var(--panel)', color: 'var(--text)' }}>
                      {d.note}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Лента заметок */}
      {notes.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[14px] font-semibold">Последние заметки группы</h2>
          <div className="flex flex-col gap-2">
            {notes.map((d) => {
              const t = trials.get(d.trial_id)
              const p = peers.find((x) => x.id === d.user_id)
              if (!t || !p) return null
              return (
                <button key={`${d.user_id}:${d.trial_id}`} onClick={() => setSelected(d.trial_id)}
                  className="text-left rounded-xl border border-[var(--line)] bg-[var(--card)] px-3.5 py-3 flex flex-col gap-1 card-hover">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[12px] font-medium">{p.id === profile.id ? 'Вы' : peerName(p)}</span>
                    <span className="text-[11px]">{STATUS_GLYPH[d.status]}</span>
                    <span className="mono text-[10px] text-[var(--muted)]">{t.nct_id}</span>
                    <span className="text-[11px] text-[var(--muted)] line-clamp-1">{t.title_ru || t.title}</span>
                  </div>
                  <p className="text-[12px] text-[var(--muted)] line-clamp-2 whitespace-pre-line">{d.note}</p>
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] px-4 py-3">
      <div className="text-xl font-bold mono">{value}</div>
      <div className="text-[11px] text-[var(--muted)] mt-0.5">{label}</div>
    </div>
  )
}
