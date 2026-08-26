import { useEffect, useMemo, useState } from 'react'
import {
  adminAddMember, adminCreateGroup, adminDeleteGroup, adminGetActivity, adminGetAllDecisions,
  adminGetDoctors, adminGetGroupMembers, adminGetGroups, adminInvite, adminRemoveMember,
  adminRenameGroup, adminSetStage, adminUpdateDoctor, getLatestTrials,
} from '../lib/api'
import StageTracker from '../components/StageTracker'
import type { Decision, Group, GroupMember, Profile, Trial, WorkStage } from '../lib/types'
import { STAGES, peerName } from '../lib/types'

export default function AdminScreen() {
  const [doctors, setDoctors] = useState<Profile[]>([])
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [trials, setTrials] = useState<Trial[]>([])
  const [activity, setActivity] = useState<{ user_id: string | null; event: string; created_at: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteMsg, setInviteMsg] = useState('')
  const [inviteGroup, setInviteGroup] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [members, setMembers] = useState<GroupMember[]>([])
  const [newGroup, setNewGroup] = useState('')
  const [groupMsg, setGroupMsg] = useState('')

  async function loadAll() {
    const [docs, decs, { trials }, act, gs, ms] = await Promise.all([
      adminGetDoctors(), adminGetAllDecisions(), getLatestTrials(), adminGetActivity(30),
      adminGetGroups(), adminGetGroupMembers(),
    ])
    setDoctors(docs); setDecisions(decs); setTrials(trials); setActivity(act as typeof activity)
    setGroups(gs); setMembers(ms)
    setLoading(false)
  }
  useEffect(() => { loadAll() }, [])

  const activeDoctors = useMemo(() => doctors.filter((d) => d.is_active), [doctors])
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

  // group_id -> список врачей в этой группе
  const groupMembers = useMemo(() => {
    const m = new Map<string, Profile[]>()
    for (const g of groups) m.set(g.id, [])
    for (const gm of members) {
      const doc = doctors.find((d) => d.id === gm.user_id)
      if (doc) m.get(gm.group_id)?.push(doc)
    }
    for (const list of m.values()) list.sort((a, b) => peerName(a).localeCompare(peerName(b), 'ru'))
    return m
  }, [groups, members, doctors])

  // user_id -> названия групп, чтобы подписать карточки врачей
  const groupsOfDoctor = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const gm of members) {
      const g = groups.find((x) => x.id === gm.group_id)
      if (!g) continue
      m.set(gm.user_id, [...(m.get(gm.user_id) ?? []), g.name])
    }
    return m
  }, [members, groups])

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

  async function setStage(d: Decision, stage: WorkStage) {
    setDecisions((prev) => prev.map((x) =>
      x.user_id === d.user_id && x.trial_id === d.trial_id ? { ...x, work_stage: stage } : x))
    try { await adminSetStage(d.user_id, d.trial_id, stage) } catch { loadAll() }
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

      {/* Работа по принятым: этапы отмечает админ, врач видит трек */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold">Работа по принятым исследованиям</h2>
        {decisions.filter((d) => d.status === 'accepted').length === 0 && (
          <p className="text-[13px] text-[var(--muted)]">Пока никто ничего не принял.</p>
        )}
        <div className="flex flex-col gap-3">
          {decisions.filter((d) => d.status === 'accepted').map((d) => {
            const doc = doctors.find((x) => x.id === d.user_id)
            const t = trials.find((x) => x.id === d.trial_id)
            if (!doc || !t) return null
            return (
              <div key={`${d.user_id}:${d.trial_id}`}
                className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 flex flex-col gap-3 card-hover">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[13px] font-semibold">{doc.full_name || doc.email}</span>
                  <span className="text-[12px] text-[var(--muted)]">·</span>
                  <span className="mono text-[11px] text-[var(--muted)]">{t.nct_id}</span>
                  <span className="text-[13px]">{t.title_ru || t.title}</span>
                </div>
                <StageTracker stage={d.work_stage} editable onSetStage={(s) => setStage(d, s)} />
              </div>
            )
          })}
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
                {d.specialty || 'без специальности'} · подписки: {d.categories.length || 'все'}
                {' · '}
                {groupsOfDoctor.get(d.id)?.length
                  ? <span style={{ color: 'var(--teal)' }}>{groupsOfDoctor.get(d.id)!.join(', ')}</span>
                  : 'без группы'}
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
            <select value={inviteGroup} onChange={(e) => setInviteGroup(e.target.value)}
              className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--teal)]">
              <option value="">без группы</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <button onClick={invite} disabled={!inviteEmail.includes('@')}
              className="px-4 py-2 rounded-xl text-[13px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--teal)', color: 'var(--on-accent)' }}>
              Пригласить
            </button>
          </div>
          {inviteMsg && <span className="text-[12px] text-[var(--muted)]">{inviteMsg}</span>}
        </div>
      </section>

      {/* Группы врачей */}
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-[14px] font-semibold">Группы врачей</h2>
          <p className="text-[12px] text-[var(--muted)]">
            Врачи одной группы видят решения, этапы и заметки друг друга на вкладке «Группа».
            Менять чужие решения по-прежнему может только администратор.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const inGroup = groupMembers.get(g.id) ?? []
            const outside = doctors.filter((d) => !inGroup.some((m) => m.id === d.id))
            return (
              <div key={g.id} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[13px] font-semibold">{g.name}</span>
                  <span className="text-[11px] text-[var(--muted)]">{inGroup.length} чел.</span>
                  <button onClick={() => renameGroup(g)}
                    className="ml-auto text-[12px] text-[var(--teal)] hover:underline">Переименовать</button>
                  <button onClick={() => deleteGroup(g)}
                    className="text-[12px] hover:underline" style={{ color: 'var(--red)' }}>Удалить</button>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {inGroup.map((m) => (
                    <span key={m.id}
                      className="text-[11px] pl-2.5 pr-1.5 py-1 rounded-full border flex items-center gap-1.5"
                      style={{ borderColor: 'var(--line)', color: m.is_active ? 'var(--text)' : 'var(--muted)' }}>
                      {peerName(m)}
                      {m.role === 'admin' && <span className="text-[9px]" style={{ color: 'var(--teal)' }}>ADMIN</span>}
                      <button onClick={() => removeMember(g.id, m.id)} title="Убрать из группы"
                        className="w-4 h-4 leading-none rounded-full hover:bg-[var(--panel)]"
                        style={{ color: 'var(--muted)' }}>×</button>
                    </span>
                  ))}
                  {inGroup.length === 0 && <span className="text-[12px] text-[var(--muted)]">Пока никого.</span>}
                </div>

                {outside.length > 0 && (
                  <select value="" onChange={(e) => addMember(g.id, e.target.value)}
                    className="self-start rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[12px] focus:outline-none focus:border-[var(--teal)]">
                    <option value="">+ Добавить врача…</option>
                    {outside.map((d) => (
                      <option key={d.id} value={d.id}>{peerName(d)} — {d.email}</option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}
          {groups.length === 0 && (
            <p className="text-[13px] text-[var(--muted)]">Групп пока нет.</p>
          )}
        </div>

        <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 flex flex-col gap-2 max-w-xl">
          <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--muted)]">Новая группа</span>
          <div className="flex gap-2 flex-wrap">
            <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createGroup() }}
              placeholder="Например: Аритмология"
              className="flex-1 min-w-[200px] rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--teal)]" />
            <button onClick={createGroup} disabled={!newGroup.trim()}
              className="px-4 py-2 rounded-xl text-[13px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--teal)', color: 'var(--on-accent)' }}>
              Создать
            </button>
          </div>
          {groupMsg && <span className="text-[12px] text-[var(--muted)]">{groupMsg}</span>}
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
