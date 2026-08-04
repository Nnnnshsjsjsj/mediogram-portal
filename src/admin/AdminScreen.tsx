import { useEffect, useMemo, useState } from 'react'
import { adminGetActivity, adminGetAllDecisions, adminGetDoctors, adminInvite, adminUpdateDoctor, getLatestTrials } from '../lib/api'
import type { Decision, Profile, Trial } from '../lib/types'
import { STAGES } from '../lib/types'

export default function AdminScreen() {
  const [doctors, setDoctors] = useState<Profile[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [trials, setTrials] = useState<Trial[]>([])
  const [activity, setActivity] = useState<{ user_id: string | null; event: string; created_at: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteMsg, setInviteMsg] = useState('')

  async function loadAll() {
    const [docs, decs, { trials }, act] = await Promise.all([
      adminGetDoctors(), adminGetAllDecisions(), getLatestTrials(), adminGetActivity(30),
    ])
    setDoctors(docs); setDecisions(decs); setTrials(trials); setActivity(act as typeof activity)
    setLoading(false)
  }
  useEffect(() => { loadAll() }, [])

  const activeDoctors = useMemo(() => doctors.filter((d) => d.role === 'doctor' && d.is_active), [doctors])
  const decMap = useMemo(() => {
    const m = new Map<string, Decision>()
    for (const d of decisions) m.set(`${d.user_id}:${d.trial_id}`, d)
    return m
  }, [decisions])

  const weekLogins = useMemo(() => {
    const since = Date.now() - 7 * 86400_000
    return new Set(activity.filter((a) => a.event === 'login' && new Date(a.created_at).getTime() > since && a.user_id).map((a) => a.user_id)).size
  }, [activity])

  const stats = useMemo(() => ({
    accepted: decisions.filter((d) => d.status === 'accepted').length,
    rejected: decisions.filter((d) => d.status === 'rejected').length,
    deferred: decisions.filter((d) => d.status === 'deferred').length,
    inWork: decisions.filter((d) => d.status === 'accepted' && d.work_stage && d.work_stage !== 'interest').length,
  }), [decisions])

  async function invite() {
    setInviteMsg('')
    try {
      await adminInvite(inviteEmail.trim(), inviteName.trim())
      setInviteMsg(`Приглашение отправлено на ${inviteEmail.trim()}`)
      setInviteEmail(''); setInviteName('')
      loadAll()
    } catch (e) {
      setInviteMsg(`Ошибка: ${(e as Error).message}. Запасной путь: Supabase Dashboard → Authentication → Invite user.`)
    }
  }

  if (loading) return <p className="py-16 text-center text-[13px] text-[var(--muted)]">Загрузка…</p>

  const currentTrials = trials.filter((t) => !t.is_upcoming)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Панель администратора</h1>

      {/* Метрики */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Врачей активно" value={activeDoctors.length} />
        <Metric label="Входов за 7 дней" value={weekLogins} />
        <Metric label="Принято / в работе" value={`${stats.accepted} / ${stats.inWork}`} />
        <Metric label="Отклонено · Отложено" value={`${stats.rejected} · ${stats.deferred}`} />
      </div>

      {/* Матрица решений */}
      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold">Матрица решений — текущий выпуск</h2>
        <div className="overflow-x-auto rounded-2xl border border-[var(--line)]">
          <table className="min-w-full text-[12px]">
            <thead>
              <tr className="bg-[var(--panel)]">
                <th className="text-left px-3 py-2.5 font-medium text-[var(--muted)] sticky left-0 bg-[var(--panel)]">Исследование</th>
                {activeDoctors.map((d) => (
                  <th key={d.id} className="px-2 py-2.5 font-medium text-[var(--muted)] whitespace-nowrap">
                    {d.full_name || d.email.split('@')[0]}
                  </th>
                ))}
                <th className="px-3 py-2.5 font-medium text-[var(--muted)]">✅</th>
              </tr>
            </thead>
            <tbody>
              {currentTrials.map((t) => {
                const acceptCount = activeDoctors.filter((d) => decMap.get(`${d.id}:${t.id}`)?.status === 'accepted').length
                return (
                  <tr key={t.id} className="border-t border-[var(--line)]">
                    <td className="px-3 py-2 sticky left-0 bg-[var(--card)] max-w-[280px]">
                      <span className="mono text-[10px] text-[var(--muted)] block">{t.nct_id}</span>
                      <span className="line-clamp-1">{t.title_ru || t.title}</span>
                    </td>
                    {activeDoctors.map((d) => {
                      const dec = decMap.get(`${d.id}:${t.id}`)
                      const glyph = dec?.status === 'accepted' ? '✅' : dec?.status === 'rejected' ? '❌' : dec?.status === 'deferred' ? '🕐' : '·'
                      const title = dec?.status === 'accepted' && dec.work_stage ? STAGES[dec.work_stage] : ''
                      return <td key={d.id} title={title} className="px-2 py-2 text-center">{glyph}</td>
                    })}
                    <td className="px-3 py-2 text-center font-semibold" style={{ color: acceptCount > 0 ? 'var(--green)' : 'var(--muted)' }}>
                      {acceptCount}
                    </td>
                  </tr>
                )
              })}
              {currentTrials.length === 0 && (
                <tr><td className="px-3 py-6 text-center text-[var(--muted)]" colSpan={activeDoctors.length + 2}>Выпуск ещё не сформирован.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Врачи */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold">Врачи</h2>
        <div className="flex flex-col gap-2">
          {doctors.map((d) => (
            <div key={d.id} className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3 flex items-center gap-3 flex-wrap">
              <div className="min-w-[180px]">
                <div className="text-[13px] font-medium">{d.full_name || '—'} {d.role === 'admin' && <span className="text-[10px] text-[var(--teal)]">ADMIN</span>}</div>
                <div className="mono text-[11px] text-[var(--muted)]">{d.email}</div>
              </div>
              <div className="text-[11px] text-[var(--muted)]">
                {d.specialty || 'без специальности'} · подписки: {d.categories.length || 'все'} · CC: {d.cc_emails.length}
              </div>
              <button onClick={async () => { await adminUpdateDoctor(d.id, { is_active: !d.is_active }); loadAll() }}
                className="ml-auto text-[12px] hover:underline"
                style={{ color: d.is_active ? 'var(--red)' : 'var(--green)' }}>
                {d.is_active ? 'Деактивировать' : 'Активировать'}
              </button>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 flex flex-col gap-2 max-w-xl">
          <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--muted)]">Пригласить врача</span>
          <div className="flex gap-2 flex-wrap">
            <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Имя Фамилия"
              className="flex-1 min-w-[160px] rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--teal)]" />
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="email@clinic.by"
              className="flex-1 min-w-[200px] rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--teal)]" />
            <button onClick={invite} disabled={!inviteEmail.includes('@')}
              className="px-4 py-2 rounded-xl text-[13px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--teal)', color: '#040810' }}>
              Пригласить
            </button>
          </div>
          {inviteMsg && <span className="text-[12px] text-[var(--muted)]">{inviteMsg}</span>}
        </div>
      </section>
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
