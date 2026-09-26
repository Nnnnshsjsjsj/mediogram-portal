import { useEffect, useMemo, useState } from 'react'
import { adminAddMember, adminCreateGroup, adminGetExpansionRequests, adminUpdateExpansionRequest } from '../lib/api'
import ExpansionSummary from '../components/ExpansionSummary'
import { StatusBadge } from '../screens/ExpansionScreen'
import type { Profile } from '../lib/types'
import type { ExpansionRequest, ExpansionStatus } from '../lib/expansion'
import { EXPANSION_STATUS, buildBotSpec, buildCategoryRulesSnippet, completeness, fmtDate } from '../lib/expansion'

// Порядок в списке: сначала то, что ждёт действий администратора.
const ORDER: ExpansionStatus[] = ['submitted', 'in_review', 'needs_info', 'approved', 'live', 'draft', 'rejected']

export default function ExpansionAdmin({ doctors, onGroupsChanged }: { doctors: Profile[]; onGroupsChanged: () => void }) {
  const [list, setList] = useState<ExpansionRequest[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [notes, setNotes] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Map<string, string>>(new Map())
  const [showDrafts, setShowDrafts] = useState(false)

  async function reload() {
    const rs = await adminGetExpansionRequests()
    setList(rs)
    setNotes(new Map(rs.map((r) => [r.id, r.admin_note ?? ''])))
  }
  useEffect(() => { reload() }, [])

  const sorted = useMemo(() => [...list]
    .filter((r) => showDrafts || r.status !== 'draft')
    .sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.updated_at.localeCompare(a.updated_at)),
    [list, showDrafts])

  const waiting = list.filter((r) => r.status === 'submitted').length
  const drafts = list.filter((r) => r.status === 'draft').length

  function say(id: string, text: string) {
    setMsg((m) => new Map(m).set(id, text))
    window.setTimeout(() => setMsg((m) => { const n = new Map(m); n.delete(id); return n }), 4000)
  }

  async function setStatus(r: ExpansionRequest, status: ExpansionStatus) {
    setBusy(r.id)
    try {
      await adminUpdateExpansionRequest(r.id, {
        status,
        admin_note: notes.get(r.id)?.trim() || null,
        reviewed_at: new Date().toISOString(),
      })
      await reload()
      say(r.id, `Статус: ${EXPANSION_STATUS[status].label}`)
    } catch (e) { say(r.id, `Ошибка: ${(e as Error).message}`) }
    finally { setBusy(null) }
  }

  async function saveNote(r: ExpansionRequest) {
    setBusy(r.id)
    try {
      await adminUpdateExpansionRequest(r.id, { admin_note: notes.get(r.id)?.trim() || null })
      await reload()
      say(r.id, 'Комментарий сохранён — врач его видит')
    } catch (e) { say(r.id, `Ошибка: ${(e as Error).message}`) }
    finally { setBusy(null) }
  }

  async function copy(r: ExpansionRequest, what: 'json' | 'rules') {
    const text = what === 'json' ? JSON.stringify(buildBotSpec(r), null, 2) : buildCategoryRulesSnippet(r)
    try {
      await navigator.clipboard.writeText(text)
      say(r.id, what === 'json' ? 'Спецификация скопирована (JSON)' : 'Фрагмент CATEGORY_RULES скопирован')
    } catch {
      window.prompt('Скопируйте вручную:', text)
    }
  }

  async function createGroup(r: ExpansionRequest) {
    const name = r.field_ru.trim()
    if (!name) return
    setBusy(r.id)
    try {
      const g = await adminCreateGroup(name)
      const emails = new Set([r.author?.email, ...r.data.colleagues].filter(Boolean).map((e) => e!.toLowerCase()))
      const members = doctors.filter((d) => emails.has(d.email.toLowerCase()))
      for (const d of members) await adminAddMember(g.id, d.id)
      const missing = [...emails].filter((e) => !members.some((d) => d.email.toLowerCase() === e))
      await adminUpdateExpansionRequest(r.id, { admin_data: { ...(r.admin_data ?? {}), group_id: g.id } })
      await reload()
      onGroupsChanged()
      say(r.id, `Группа «${name}» создана, добавлено ${members.length}` + (missing.length ? `; ещё не в портале: ${missing.join(', ')}` : ''))
    } catch (e) {
      say(r.id, /duplicate|unique/i.test((e as Error).message) ? `Группа «${name}» уже есть` : `Ошибка: ${(e as Error).message}`)
    } finally { setBusy(null) }
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-[14px] font-semibold">Заявки на новые направления</h2>
        {waiting > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: 'var(--teal)', color: 'var(--on-accent)' }}>
            {waiting} ждут ответа
          </span>
        )}
        {drafts > 0 && (
          <button onClick={() => setShowDrafts(!showDrafts)} className="text-[12px] text-[var(--muted)] hover:underline ml-auto">
            {showDrafts ? 'Скрыть черновики' : `Показать черновики врачей (${drafts})`}
          </button>
        )}
      </div>

      {sorted.length === 0 && <p className="text-[13px] text-[var(--muted)]">Заявок пока нет.</p>}

      <div className="flex flex-col gap-3">
        {sorted.map((r) => {
          const isOpen = open === r.id
          const c = completeness(r.field_ru, r.field_en, r.data)
          const subs = r.data.subareas.filter((s) => s.name_ru.trim())
          const hasGroup = !!(r.admin_data as { group_id?: string } | undefined)?.group_id
          return (
            <div key={r.id} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] flex flex-col">
              <button onClick={() => setOpen(isOpen ? null : r.id)} className="text-left p-4 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold">{r.field_ru || 'Без названия'}</span>
                  {r.field_en && <span className="text-[12px] text-[var(--muted)]">{r.field_en}</span>}
                  <StatusBadge status={r.status} />
                  <span className="mono text-[11px] text-[var(--muted)] ml-auto">
                    {r.submitted_at ? `отправлена ${fmtDate(r.submitted_at)}` : `черновик, ${fmtDate(r.updated_at)}`}
                  </span>
                </div>
                <div className="text-[12px] text-[var(--muted)] flex gap-2 flex-wrap">
                  <span>{r.author?.full_name || r.author?.email || '—'}</span>
                  <span>·</span>
                  <span>{subs.length ? subs.map((s) => s.name_ru).join(', ') : 'подобласти не указаны'}</span>
                  <span>·</span>
                  <span>{r.data.keywords_en.length} ключевых слов, {r.data.conditions.length} заболеваний</span>
                  {r.status === 'draft' && <span>· заполнено {c.pct}%</span>}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-[var(--line)] p-4 flex flex-col gap-5">
                  {/* Управление */}
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3.5 flex flex-col gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-medium">Статус</span>
                      {(['in_review', 'needs_info', 'approved', 'live', 'rejected'] as ExpansionStatus[]).map((s) => (
                        <button key={s} onClick={() => setStatus(r, s)} disabled={busy === r.id || r.status === s}
                          className="text-[12px] px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50"
                          style={r.status === s
                            ? { borderColor: EXPANSION_STATUS[s].color, color: 'var(--on-accent)', background: EXPANSION_STATUS[s].color }
                            : { borderColor: 'var(--line)', color: EXPANSION_STATUS[s].color }}>
                          {EXPANSION_STATUS[s].label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[12px] font-medium">Комментарий врачу</span>
                      <textarea value={notes.get(r.id) ?? ''} onChange={(e) => setNotes((m) => new Map(m).set(r.id, e.target.value))} rows={2}
                        placeholder="Например: уточните, какие именно операции при МКБ делаете — от этого зависят термины поиска"
                        className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-[13px] resize-y focus:outline-none focus:border-[var(--teal)]" />
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => saveNote(r)} disabled={busy === r.id}
                          className="px-3 py-1.5 rounded-xl text-[12px] font-medium border border-[var(--line)] disabled:opacity-50">
                          Сохранить комментарий
                        </button>
                        <span className="w-px h-4 bg-[var(--line)] mx-1" />
                        <button onClick={() => copy(r, 'json')} className="text-[12px] text-[var(--teal)] hover:underline">Спецификация для радара (JSON)</button>
                        <button onClick={() => copy(r, 'rules')} className="text-[12px] text-[var(--teal)] hover:underline">Фрагмент CATEGORY_RULES</button>
                        <button onClick={() => createGroup(r)} disabled={busy === r.id || hasGroup || !r.field_ru.trim()}
                          className="text-[12px] text-[var(--teal)] hover:underline disabled:opacity-50 disabled:no-underline">
                          {hasGroup ? 'Группа создана' : `Создать группу «${r.field_ru || '…'}»`}
                        </button>
                      </div>
                      {msg.get(r.id) && <span className="text-[12px]" style={{ color: 'var(--muted)' }}>{msg.get(r.id)}</span>}
                    </div>
                  </div>

                  {/* Чего не хватает */}
                  {c.items.some((i) => !i.done) && (
                    <div className="text-[12px] text-[var(--muted)] flex flex-wrap gap-x-4 gap-y-1">
                      <span className="font-medium">Не заполнено:</span>
                      {c.items.filter((i) => !i.done).map((i) => (
                        <span key={i.key} style={{ color: i.required ? 'var(--red)' : undefined }}>{i.label}</span>
                      ))}
                    </div>
                  )}

                  <ExpansionSummary r={r} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
