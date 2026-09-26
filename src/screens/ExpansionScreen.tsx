import { useEffect, useMemo, useRef, useState } from 'react'
import TagInput from '../components/TagInput'
import ExpansionSummary from '../components/ExpansionSummary'
import {
  createExpansionRequest, deleteExpansionRequest, getMyExpansionRequests, logEvent, updateExpansionRequest,
} from '../lib/api'
import type { Profile } from '../lib/types'
import type { ExpansionData, ExpansionRequest, SubArea } from '../lib/expansion'
import {
  AGE_GROUPS, DIGEST_FREQ, ETHICS, EXPANSION_STATUS, INFRASTRUCTURE, PHASES, PRIORITY, RESPONSE_TIME,
  STUDY_TYPES, TRIAL_EXPERIENCE, completeness, emptyExpansionData, emptySubArea, fmtDate,
} from '../lib/expansion'

type Mode = { kind: 'list' } | { kind: 'edit'; r: ExpansionRequest | null } | { kind: 'view'; r: ExpansionRequest }

export default function ExpansionScreen({ profile }: { profile: Profile }) {
  const [list, setList] = useState<ExpansionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>({ kind: 'list' })

  async function reload() {
    setList(await getMyExpansionRequests())
    setLoading(false)
  }
  useEffect(() => { reload(); logEvent('expansion_view') }, [])

  if (loading) return <p className="py-16 text-center text-[13px] text-[var(--muted)]">Загрузка…</p>

  if (mode.kind === 'edit') {
    return <ExpansionForm profile={profile} initial={mode.r}
      onDone={async () => { await reload(); setMode({ kind: 'list' }) }} />
  }

  if (mode.kind === 'view') {
    const r = mode.r
    const st = EXPANSION_STATUS[r.status]
    const editable = r.status === 'draft' || r.status === 'needs_info'
    return (
      <div className="flex flex-col gap-4">
        <button onClick={() => setMode({ kind: 'list' })} className="text-[13px] text-[var(--teal)] hover:underline self-start">← К списку заявок</button>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-semibold">{r.field_ru || 'Без названия'}</h1>
          <StatusBadge status={r.status} />
          {editable && (
            <button onClick={() => setMode({ kind: 'edit', r })}
              className="ml-auto px-4 py-2 rounded-xl text-[13px] font-semibold"
              style={{ background: 'var(--teal)', color: 'var(--on-accent)' }}>
              {r.status === 'needs_info' ? 'Дополнить и отправить' : 'Редактировать'}
            </button>
          )}
        </div>
        <p className="text-[12px] text-[var(--muted)]">{st.hint}</p>
        {r.admin_note && <AdminNote note={r.admin_note} />}
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <ExpansionSummary r={r} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">Новое направление</h1>
          <p className="text-[13px] text-[var(--muted)] max-w-xl mt-1">
            Портал сейчас ищет исследования по кардиологии. Чтобы подключить другую область — урологию,
            онкологию, неврологию — заполните чеклист: он нужен, чтобы радар искал правильные исследования,
            а спонсоры сразу видели возможности вашего центра.
          </p>
        </div>
        <button onClick={() => setMode({ kind: 'edit', r: null })}
          className="px-4 py-2 rounded-xl text-[13px] font-semibold"
          style={{ background: 'var(--teal)', color: 'var(--on-accent)' }}>
          + Новая заявка
        </button>
      </div>

      {list.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--line)] p-8 text-center text-[13px] text-[var(--muted)]">
          Заявок пока нет. Заполнение занимает 15–20 минут; черновик сохраняется автоматически, можно вернуться позже.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {list.map((r) => {
          const c = completeness(r.field_ru, r.field_en, r.data)
          return (
            <button key={r.id} onClick={() => setMode({ kind: 'view', r })}
              className="text-left rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 flex flex-col gap-2 card-hover">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-semibold">{r.field_ru || 'Без названия'}</span>
                {r.field_en && <span className="text-[12px] text-[var(--muted)]">{r.field_en}</span>}
                <StatusBadge status={r.status} />
                <span className="mono text-[11px] text-[var(--muted)] ml-auto">
                  {r.submitted_at ? `отправлена ${fmtDate(r.submitted_at)}` : `изменена ${fmtDate(r.updated_at)}`}
                </span>
              </div>
              <div className="text-[12px] text-[var(--muted)] flex items-center gap-2 flex-wrap">
                <span>{r.data.subareas.filter((s) => s.name_ru.trim()).map((s) => s.name_ru).join(', ') || 'подобласти не указаны'}</span>
                {r.status === 'draft' && (
                  <span className="ml-auto flex items-center gap-2">
                    <span className="w-24 h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
                      <span className="block h-full rounded-full" style={{ width: `${c.pct}%`, background: 'var(--teal)' }} />
                    </span>
                    <span className="mono text-[11px]">{c.pct}%</span>
                  </span>
                )}
              </div>
              {r.admin_note && r.status === 'needs_info' && (
                <p className="text-[12px] rounded-lg px-3 py-2" style={{ background: 'var(--amber-soft)', color: 'var(--text)' }}>
                  Mediogram: {r.admin_note}
                </p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ================================================================ форма

function ExpansionForm({ profile, initial, onDone }: { profile: Profile; initial: ExpansionRequest | null; onDone: () => void }) {
  const [id, setId] = useState<string | null>(initial?.id ?? null)
  const [fieldRu, setFieldRu] = useState(initial?.field_ru ?? '')
  const [fieldEn, setFieldEn] = useState(initial?.field_en ?? '')
  const [data, setData] = useState<ExpansionData>(() => {
    if (initial) return initial.data
    const d = emptyExpansionData()
    d.lead_name = profile.full_name
    d.contact = profile.email
    return d
  })
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showMissing, setShowMissing] = useState(false)
  const timer = useRef<number | null>(null)
  const firstRender = useRef(true)
  const creating = useRef(false)

  const comp = useMemo(() => completeness(fieldRu, fieldEn, data), [fieldRu, fieldEn, data])
  const set = <K extends keyof ExpansionData>(k: K, v: ExpansionData[K]) => setData((d) => ({ ...d, [k]: v }))

  // Автосохранение черновика через полторы секунды после последней правки.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    setSaveState('dirty')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, 1500)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldRu, fieldEn, data])

  async function save(): Promise<string | null> {
    if (!fieldRu.trim() && !id) return null   // пустую форму не плодим
    setSaveState('saving'); setError('')
    try {
      if (id) {
        await updateExpansionRequest(id, { field_ru: fieldRu, field_en: fieldEn, data })
        setSaveState('saved')
        return id
      }
      if (creating.current) return null
      creating.current = true
      const r = await createExpansionRequest(fieldRu, fieldEn, data)
      creating.current = false
      setId(r.id)
      setSaveState('saved')
      return r.id
    } catch (e) {
      creating.current = false
      setSaveState('error'); setError((e as Error).message)
      return null
    }
  }

  async function submit() {
    if (!comp.canSubmit) { setShowMissing(true); return }
    setSubmitting(true); setError('')
    try {
      if (timer.current) window.clearTimeout(timer.current)
      const rid = id ?? await save()
      if (!rid) throw new Error('Не удалось сохранить заявку')
      await updateExpansionRequest(rid, { field_ru: fieldRu, field_en: fieldEn, data, status: 'submitted' })
      logEvent('expansion_submit', { id: rid, field: fieldEn })
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally { setSubmitting(false) }
  }

  async function leave() {
    if (timer.current) window.clearTimeout(timer.current)
    if (saveState === 'dirty' || saveState === 'error') await save()
    onDone()
  }

  async function discard() {
    if (id && initial?.status !== 'needs_info') {
      if (!window.confirm('Удалить черновик заявки?')) return
      try { await deleteExpansionRequest(id) } catch { /* no-op */ }
    }
    onDone()
  }

  function setSub(i: number, patch: Partial<SubArea>) {
    set('subareas', data.subareas.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  const toggle = (arr: string[], k: string) => (arr.includes(k) ? arr.filter((x) => x !== k) : [...arr, k])

  return (
    <div className="flex flex-col gap-5 pb-20">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={leave} className="text-[13px] text-[var(--teal)] hover:underline">← К списку</button>
        <h1 className="text-lg font-semibold">{initial ? 'Заявка на направление' : 'Новая заявка на направление'}</h1>
        <span className="ml-auto text-[11px] text-[var(--muted)] mono">
          {saveState === 'saving' ? 'сохраняю…' : saveState === 'saved' ? 'черновик сохранён' : saveState === 'dirty' ? 'есть несохранённые правки' : saveState === 'error' ? 'ошибка сохранения' : ''}
        </span>
      </div>

      {initial?.admin_note && initial.status === 'needs_info' && <AdminNote note={initial.admin_note} />}

      <p className="text-[12px] text-[var(--muted)]">
        Поля со звёздочкой обязательны. Англоязычные термины важнее русских: радар ищет по ClinicalTrials.gov
        и европейскому реестру, где всё на английском.
      </p>

      {/* 1 */}
      <Section n={1} title="Направление и центр" hint="Кто вы и о какой области речь">
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Направление (рус.)" required>
            <Input value={fieldRu} onChange={setFieldRu} placeholder="Урология" />
          </Field>
          <Field label="Направление (англ.)" required hint="Как называется специальность в англоязычной литературе">
            <Input value={fieldEn} onChange={setFieldEn} placeholder="Urology" />
          </Field>
        </div>
        <Field label="Чем занимается ваш центр в этом направлении" hint="2–4 предложения: профиль пациентов, ключевые методики, что делаете чаще всего">
          <Textarea value={data.description} onChange={(v) => set('description', v)} rows={3}
            placeholder="Например: отделение урологии на 40 коек, ежегодно ~600 операций по поводу МКБ и ДГПЖ, есть кабинет уродинамики…" />
        </Field>
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Учреждение" required><Input value={data.institution} onChange={(v) => set('institution', v)} placeholder="РНПЦ…" /></Field>
          <Field label="Отделение"><Input value={data.department} onChange={(v) => set('department', v)} placeholder="Отделение урологии" /></Field>
          <Field label="Город"><Input value={data.city} onChange={(v) => set('city', v)} placeholder="Минск" /></Field>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Ответственный врач" required><Input value={data.lead_name} onChange={(v) => set('lead_name', v)} placeholder="Имя Фамилия" /></Field>
          <Field label="Должность"><Input value={data.lead_position} onChange={(v) => set('lead_position', v)} placeholder="Заведующий отделением, к.м.н." /></Field>
          <Field label="Контакт" required><Input value={data.contact} onChange={(v) => set('contact', v)} placeholder="email или телефон" /></Field>
        </div>
      </Section>

      {/* 2 */}
      <Section n={2} title="Подобласти" hint="Каждая подобласть станет отдельной категорией в портале — как сейчас «Аритмология» или «Сердечная недостаточность». Врачи смогут подписываться на них по отдельности.">
        <div className="flex flex-col gap-3">
          {data.subareas.map((s, i) => (
            <div key={i} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3.5 flex flex-col gap-3">
              <div className="grid md:grid-cols-[1fr_1fr_150px_auto] gap-2 items-end">
                <Field label="Название (рус.)" required compact><Input value={s.name_ru} onChange={(v) => setSub(i, { name_ru: v })} placeholder="Андрология" /></Field>
                <Field label="Название (англ.)" required compact><Input value={s.name_en} onChange={(v) => setSub(i, { name_en: v })} placeholder="Andrology" /></Field>
                <Field label="Приоритет" compact>
                  <Select value={s.priority} onChange={(v) => setSub(i, { priority: v as SubArea['priority'] })} options={PRIORITY} />
                </Field>
                <button onClick={() => set('subareas', data.subareas.length > 1 ? data.subareas.filter((_, idx) => idx !== i) : [emptySubArea()])}
                  className="text-[12px] hover:underline pb-2.5" style={{ color: 'var(--red)' }}>Убрать</button>
              </div>
              <Field label="Термины поиска (англ.)" required compact
                hint="По ним радар отнесёт исследование именно к этой подобласти. Диагнозы, процедуры, названия устройств и препаратов — как в названиях исследований.">
                <TagInput value={s.terms} onChange={(v) => setSub(i, { terms: v })} mono transform={(t) => t.toLowerCase()}
                  placeholder="erectile dysfunction, hypogonadism, male infertility, testosterone…" />
              </Field>
              <Field label="Примечание" compact>
                <Input value={s.note} onChange={(v) => setSub(i, { note: v })} placeholder="Что важно именно для вас в этой подобласти" />
              </Field>
            </div>
          ))}
          <button onClick={() => set('subareas', [...data.subareas, emptySubArea()])}
            className="self-start text-[13px] text-[var(--teal)] hover:underline">+ Добавить подобласть</button>
        </div>
      </Section>

      {/* 3 */}
      <Section n={3} title="Что искать" hint="Клинические границы поиска: какие пациенты, какие вмешательства, чего не надо">
        <Field label="Заболевания и состояния (англ.)" required hint="Минимум три. Пишите так, как их называют в ClinicalTrials.gov: «prostate cancer», «benign prostatic hyperplasia», «overactive bladder»">
          <TagInput value={data.conditions} onChange={(v) => set('conditions', v)} mono transform={(t) => t.toLowerCase()} placeholder="prostate cancer, kidney stones, …" />
        </Field>
        <Field label="Интересующие вмешательства (англ.)" hint="Классы препаратов, типы устройств, процедуры: «PSMA-targeted therapy», «laser lithotripsy», «sacral neuromodulation»">
          <TagInput value={data.interventions} onChange={(v) => set('interventions', v)} mono transform={(t) => t.toLowerCase()} placeholder="…" />
        </Field>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Типы исследований" required>
            <CheckGroup value={data.study_types} onToggle={(k) => set('study_types', toggle(data.study_types, k))} options={STUDY_TYPES} />
          </Field>
          <Field label="Фазы">
            <CheckGroup value={data.phases} onToggle={(k) => set('phases', toggle(data.phases, k))} options={PHASES} />
          </Field>
          <Field label="Возраст пациентов">
            <CheckGroup value={data.age_groups} onToggle={(k) => set('age_groups', toggle(data.age_groups, k))} options={AGE_GROUPS} />
          </Field>
        </div>
        <Field label="Что исключить из поиска (англ.)" hint="Термины, при которых исследование вам точно не подходит — сильно снижает шум">
          <TagInput value={data.exclude} onChange={(v) => set('exclude', v)} mono transform={(t) => t.toLowerCase()}
            placeholder="pediatric, veterinary, healthy volunteers…"
            suggestions={['pediatric', 'healthy volunteers', 'animal', 'in vitro', 'survey', 'nursing']} />
        </Field>
      </Section>

      {/* 4 */}
      <Section n={4} title="Ключевые слова для радара" hint="Самая полезная часть для бота. Чем точнее слова — тем меньше мусора в дайджесте">
        <Field label="Ключевые слова (англ.)" required hint="Минимум пять. Всё, по чему вы сами искали бы исследования: синонимы, аббревиатуры (BPH, OAB, RCC), названия методик">
          <TagInput value={data.keywords_en} onChange={(v) => set('keywords_en', v)} mono transform={(t) => t.toLowerCase()} placeholder="BPH, nephrolithiasis, urinary incontinence, …" />
        </Field>
        <Field label="Ключевые слова (рус.)" hint="Необязательно. Помогают правильно подписывать карточки и категории по-русски">
          <TagInput value={data.keywords_ru} onChange={(v) => set('keywords_ru', v)} placeholder="ДГПЖ, мочекаменная болезнь, недержание…" />
        </Field>
        <Field label="Известные спонсоры и компании" hint="Кто в этой области ведёт исследования: фарма, производители устройств, CRO, с кем уже работали">
          <TagInput value={data.sponsors} onChange={(v) => set('sponsors', v)} placeholder="Astellas, Boston Scientific, Bayer…" />
        </Field>
        <Field label="Примеры подходящих исследований" hint="Номера NCT с ClinicalTrials.gov, которые вы бы приняли. По ним мы калибруем поиск — это точнее любых ключевых слов">
          <TagInput value={data.example_ncts} onChange={(v) => set('example_ncts', v)} mono transform={(t) => t.toUpperCase().replace(/\s/g, '')} placeholder="NCT01234567" />
        </Field>
      </Section>

      {/* 5 */}
      <Section n={5} title="Возможности центра" hint="То, о чём спонсор спросит первым делом при feasibility">
        <div className="grid md:grid-cols-3 gap-3">
          <Field label="Поток пациентов по направлению" required hint="Примерно, в месяц">
            <Input value={data.patients_per_month} onChange={(v) => set('patients_per_month', v)} placeholder="≈150" />
          </Field>
          <Field label="Опыт клинических исследований" required>
            <Select value={data.trial_experience} onChange={(v) => set('trial_experience', v as ExpansionData['trial_experience'])} options={TRIAL_EXPERIENCE} placeholder="Выберите" />
          </Field>
          <Field label="Врачей с сертификатом GCP" hint="Число">
            <Input value={data.gcp_doctors} onChange={(v) => set('gcp_doctors', v)} placeholder="2" />
          </Field>
        </div>
        <Field label="Инфраструктура">
          <CheckGroup value={data.infrastructure} onToggle={(k) => set('infrastructure', toggle(data.infrastructure, k))} options={INFRASTRUCTURE} columns />
        </Field>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Другое оборудование" hint="Что ещё важно для вашей области">
            <Input value={data.infrastructure_other} onChange={(v) => set('infrastructure_other', v)} placeholder="Уродинамическая установка, литотриптер…" />
          </Field>
          <Field label="Этический комитет">
            <Select value={data.ethics_committee} onChange={(v) => set('ethics_committee', v as ExpansionData['ethics_committee'])} options={ETHICS} placeholder="Выберите" />
          </Field>
        </div>
      </Section>

      {/* 6 */}
      <Section n={6} title="Команда и формат работы" hint="Кого подключить и как часто присылать подборки">
        <Field label="Коллеги, которым нужен доступ" hint="Рабочие email. Мы пригласим их в портал и добавим в вашу группу">
          <TagInput value={data.colleagues} onChange={(v) => set('colleagues', v)} mono transform={(t) => t.toLowerCase()} placeholder="doctor@clinic.by" />
        </Field>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="Частота дайджеста">
            <Select value={data.digest_frequency} onChange={(v) => set('digest_frequency', v as ExpansionData['digest_frequency'])} options={DIGEST_FREQ} />
          </Field>
          <Field label="Как быстро сможете отвечать спонсору">
            <Select value={data.response_time} onChange={(v) => set('response_time', v as ExpansionData['response_time'])} options={RESPONSE_TIME} placeholder="Выберите" />
          </Field>
        </div>
        <Field label="Комментарий" hint="Всё, что не поместилось выше">
          <Textarea value={data.notes} onChange={(v) => set('notes', v)} rows={3} placeholder="…" />
        </Field>
      </Section>

      {error && <p className="text-[12px]" style={{ color: 'var(--red)' }}>{error}</p>}

      {/* Нижняя панель */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--line)] bg-[var(--panel)]/95 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <button onClick={() => setShowMissing(!showMissing)} className="flex items-center gap-2 text-left">
            <span className="w-28 h-1.5 rounded-full bg-[var(--line)] overflow-hidden">
              <span className="block h-full rounded-full transition-all" style={{ width: `${comp.pct}%`, background: comp.canSubmit ? 'var(--green)' : 'var(--teal)' }} />
            </span>
            <span className="text-[12px] text-[var(--muted)]">
              Заполнено {comp.pct}% · {comp.canSubmit ? 'можно отправлять' : `осталось обязательных: ${comp.items.filter((i) => i.required && !i.done).length}`}
            </span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={discard} className="text-[12px] text-[var(--muted)] hover:underline px-2">
              {id && initial?.status !== 'needs_info' ? 'Удалить черновик' : 'Отмена'}
            </button>
            <button onClick={save} disabled={saveState === 'saving'}
              className="px-3.5 py-2 rounded-xl text-[13px] font-medium border border-[var(--line)] disabled:opacity-50">
              Сохранить черновик
            </button>
            <button onClick={submit} disabled={submitting}
              className="px-4 py-2 rounded-xl text-[13px] font-semibold disabled:opacity-50"
              style={{ background: comp.canSubmit ? 'var(--teal)' : 'var(--muted)', color: 'var(--on-accent)' }}>
              {submitting ? 'Отправляю…' : initial?.status === 'needs_info' ? 'Отправить снова' : 'Отправить в Mediogram'}
            </button>
          </div>
        </div>
        {showMissing && (
          <div className="mx-auto max-w-4xl px-4 pb-3">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 grid md:grid-cols-2 gap-x-6 gap-y-1">
              {comp.items.map((i) => (
                <div key={i.key} className="text-[12px] flex items-center gap-2">
                  <span style={{ color: i.done ? 'var(--green)' : i.required ? 'var(--red)' : 'var(--muted)' }}>{i.done ? '✓' : i.required ? '•' : '○'}</span>
                  <span className={i.done ? 'text-[var(--muted)] line-through' : ''}>{i.label}{!i.required && !i.done ? ' (желательно)' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ================================================================ мелкие элементы

export function StatusBadge({ status }: { status: ExpansionRequest['status'] }) {
  const st = EXPANSION_STATUS[status]
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-full border font-medium" style={{ borderColor: st.color, color: st.color }}>
      {st.label}
    </span>
  )
}

function AdminNote({ note }: { note: string }) {
  return (
    <div className="rounded-xl px-4 py-3 text-[13px] whitespace-pre-line" style={{ background: 'var(--amber-soft)' }}>
      <span className="text-[11px] uppercase tracking-wide font-semibold block mb-1" style={{ color: 'var(--amber)' }}>Комментарий Mediogram</span>
      {note}
    </div>
  )
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 flex flex-col gap-4">
      <header className="flex items-start gap-3">
        <span className="mono text-[12px] font-semibold w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ background: 'var(--teal-soft)', color: 'var(--teal)' }}>{n}</span>
        <div>
          <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
          {hint && <p className="text-[12px] text-[var(--muted)] mt-0.5">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  )
}

function Field({ label, hint, required, compact, children }: { label: string; hint?: string; required?: boolean; compact?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col ${compact ? 'gap-1' : 'gap-1.5'}`}>
      <span className="text-[12px] font-medium">
        {label}{required && <span style={{ color: 'var(--red)' }}> *</span>}
      </span>
      {children}
      {hint && <span className="text-[11px] text-[var(--muted)]">{hint}</span>}
    </div>
  )
}

const inputCls = 'w-full rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[13px] focus:outline-none focus:border-[var(--teal)]'

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
}

function Textarea({ value, onChange, placeholder, rows }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows ?? 3} className={`${inputCls} resize-y`} />
}

function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: Record<string, string>; placeholder?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {placeholder && <option value="">{placeholder}</option>}
      {Object.entries(options).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  )
}

function CheckGroup({ value, onToggle, options, columns }: { value: string[]; onToggle: (k: string) => void; options: Record<string, string>; columns?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 ${columns ? 'md:grid md:grid-cols-2' : ''}`}>
      {Object.entries(options).map(([k, l]) => {
        const on = value.includes(k)
        return (
          <button key={k} type="button" onClick={() => onToggle(k)}
            className="flex items-center gap-2 text-left text-[13px] rounded-lg px-2 py-1 -mx-2 hover:bg-[var(--panel)]">
            <span className="w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0"
              style={on ? { background: 'var(--teal)', borderColor: 'var(--teal)', color: 'var(--on-accent)' } : { borderColor: 'var(--line-strong)' }}>
              {on ? '✓' : ''}
            </span>
            {l}
          </button>
        )
      })}
    </div>
  )
}
