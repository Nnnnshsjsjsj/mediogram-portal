// Заявка на новое направление: типы чеклиста, словари, полнота и
// спецификация для радара. Сам чеклист хранится в expansion_requests.data (jsonb).

export type ExpansionStatus =
  | 'draft' | 'submitted' | 'in_review' | 'needs_info' | 'approved' | 'live' | 'rejected'

export const EXPANSION_STATUS: Record<ExpansionStatus, { label: string; color: string; hint: string }> = {
  draft:      { label: 'Черновик',          color: 'var(--muted)', hint: 'Видите только вы. Можно редактировать.' },
  submitted:  { label: 'Отправлена',        color: 'var(--teal)',  hint: 'Mediogram получил заявку и скоро возьмёт в работу.' },
  in_review:  { label: 'В работе',          color: 'var(--amber)', hint: 'Mediogram настраивает поиск и категории.' },
  needs_info: { label: 'Нужны уточнения',   color: 'var(--red)',   hint: 'Посмотрите комментарий и дополните заявку.' },
  approved:   { label: 'Одобрена',          color: 'var(--green)', hint: 'Направление принято, идёт подключение к порталу.' },
  live:       { label: 'Подключено',        color: 'var(--green)', hint: 'Направление работает в портале.' },
  rejected:   { label: 'Отклонена',         color: 'var(--red)',   hint: 'Причина — в комментарии Mediogram.' },
}

export type Priority = 'high' | 'medium' | 'low'
export const PRIORITY: Record<Priority, string> = { high: 'Высокий', medium: 'Средний', low: 'Низкий' }

export interface SubArea {
  name_ru: string
  name_en: string
  priority: Priority
  terms: string[]      // EN-термины, по которым радар отнесёт исследование к этой подобласти
  note: string
}

export interface ExpansionData {
  // 1. Направление и центр
  description: string
  institution: string
  department: string
  city: string
  lead_name: string
  lead_position: string
  contact: string
  // 2. Подобласти — будущие категории портала
  subareas: SubArea[]
  // 3. Что искать
  conditions: string[]
  interventions: string[]
  study_types: string[]
  phases: string[]
  age_groups: string[]
  exclude: string[]
  // 4. Ключевые слова для радара
  keywords_en: string[]
  keywords_ru: string[]
  sponsors: string[]
  example_ncts: string[]
  // 5. Возможности центра
  patients_per_month: string
  trial_experience: '' | 'none' | '1-3' | '4-10' | '10+'
  gcp_doctors: string
  infrastructure: string[]
  infrastructure_other: string
  ethics_committee: '' | 'yes' | 'no' | 'unknown'
  // 6. Команда
  colleagues: string[]
  digest_frequency: '' | 'weekly' | 'biweekly' | 'monthly'
  response_time: '' | 'lt1w' | '1-2w' | 'gt2w'
  notes: string
}

export interface ExpansionRequest {
  id: string
  created_by: string
  status: ExpansionStatus
  field_ru: string
  field_en: string
  data: ExpansionData
  admin_note: string | null
  admin_data?: Record<string, unknown>
  submitted_at: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  // подтягивается join'ом в админке
  author?: { id: string; full_name: string; email: string; specialty: string | null }
}

export const STUDY_TYPES: Record<string, string> = {
  drug: 'Лекарственные препараты',
  device: 'Медицинские изделия',
  procedure: 'Процедуры и хирургия',
  diagnostic: 'Диагностика',
  observational: 'Наблюдательные / регистры',
}

export const PHASES: Record<string, string> = {
  '1': 'Фаза I', '2': 'Фаза II', '3': 'Фаза III', '4': 'Фаза IV', na: 'Без фазы (устройства)',
}

export const AGE_GROUPS: Record<string, string> = {
  adult: 'Взрослые', elderly: 'Пожилые (65+)', pediatric: 'Дети',
}

export const INFRASTRUCTURE: Record<string, string> = {
  inpatient: 'Стационар',
  day_hospital: 'Дневной стационар',
  or: 'Операционная',
  icu: 'Реанимация / ПИТ',
  lab: 'Лаборатория',
  imaging: 'Визуализация (КТ / МРТ / УЗИ)',
  freezer: 'Морозильник −80 °C',
  pharmacy: 'Аптека для исследуемых препаратов',
  archive: 'Архив документов',
  monitoring_room: 'Кабинет для монитора',
}

export const TRIAL_EXPERIENCE: Record<string, string> = {
  none: 'Ещё не участвовали', '1-3': '1–3 исследования', '4-10': '4–10 исследований', '10+': 'Больше 10',
}
export const ETHICS: Record<string, string> = { yes: 'Есть локальный ЭК', no: 'Нет', unknown: 'Не знаю' }
export const DIGEST_FREQ: Record<string, string> = { weekly: 'Раз в неделю', biweekly: 'Раз в две недели', monthly: 'Раз в месяц' }
export const RESPONSE_TIME: Record<string, string> = { lt1w: 'До недели', '1-2w': '1–2 недели', gt2w: 'Больше двух недель' }

export function emptyExpansionData(): ExpansionData {
  return {
    description: '', institution: '', department: '', city: '',
    lead_name: '', lead_position: '', contact: '',
    subareas: [emptySubArea()],
    conditions: [], interventions: [], study_types: [], phases: [], age_groups: ['adult'], exclude: [],
    keywords_en: [], keywords_ru: [], sponsors: [], example_ncts: [],
    patients_per_month: '', trial_experience: '', gcp_doctors: '',
    infrastructure: [], infrastructure_other: '', ethics_committee: '',
    colleagues: [], digest_frequency: 'weekly', response_time: '', notes: '',
  }
}

export function emptySubArea(): SubArea {
  return { name_ru: '', name_en: '', priority: 'medium', terms: [], note: '' }
}

// Старые заявки могут не иметь новых полей — доливаем значения по умолчанию.
export function normalizeExpansionData(raw: unknown): ExpansionData {
  const d = { ...emptyExpansionData(), ...(raw && typeof raw === 'object' ? raw as Partial<ExpansionData> : {}) }
  if (!Array.isArray(d.subareas) || d.subareas.length === 0) d.subareas = [emptySubArea()]
  d.subareas = d.subareas.map((s) => ({ ...emptySubArea(), ...s, terms: s.terms ?? [] }))
  return d
}

// ---------- полнота заявки ----------

export interface CompletenessItem { key: string; label: string; done: boolean; required: boolean }

export function completeness(fieldRu: string, fieldEn: string, d: ExpansionData): { pct: number; items: CompletenessItem[]; canSubmit: boolean } {
  const subOk = d.subareas.filter((s) => s.name_ru.trim())
  const subTermsOk = subOk.filter((s) => s.terms.length > 0)
  const items: CompletenessItem[] = [
    { key: 'field',       label: 'Название направления',                        done: !!fieldRu.trim(), required: true },
    { key: 'lead',        label: 'Ответственный врач и контакт',                 done: !!d.lead_name.trim() && !!d.contact.trim(), required: true },
    { key: 'institution', label: 'Учреждение и отделение',                       done: !!d.institution.trim(), required: true },
    { key: 'subareas',    label: 'Хотя бы одна подобласть с названием',          done: subOk.length > 0, required: true },
    { key: 'subterms',    label: 'У каждой подобласти указано, что к ней относится', done: subOk.length > 0 && subTermsOk.length === subOk.length, required: true },
    { key: 'conditions',  label: 'Не меньше трёх заболеваний',                   done: d.conditions.length >= 3, required: true },
    { key: 'keywords',    label: 'Не меньше пяти ключевых слов',                  done: d.keywords_ru.length >= 5, required: true },
    { key: 'study_types', label: 'Типы исследований',                            done: d.study_types.length > 0, required: true },
    { key: 'patients',    label: 'Поток пациентов',                              done: !!d.patients_per_month.trim(), required: true },
    { key: 'experience',  label: 'Опыт клинических исследований',                done: !!d.trial_experience, required: true },
    { key: 'description', label: 'Описание направления в центре',                done: d.description.trim().length >= 40, required: false },
    { key: 'interventions', label: 'Интересующие вмешательства',                 done: d.interventions.length > 0, required: false },
    { key: 'exclude',     label: 'Что исключить из поиска',                      done: d.exclude.length > 0, required: false },
    { key: 'sponsors',    label: 'Известные спонсоры',                           done: d.sponsors.length > 0, required: false },
    { key: 'ncts',        label: 'Примеры подходящих исследований (NCT)',        done: d.example_ncts.length > 0, required: false },
    { key: 'infra',       label: 'Инфраструктура центра',                        done: d.infrastructure.length > 0, required: false },
    { key: 'colleagues',  label: 'Коллеги для подключения',                      done: d.colleagues.length > 0, required: false },
    { key: 'english',     label: 'Английские термины',                           done: !!fieldEn.trim() || d.keywords_en.length > 0, required: false },
  ]
  const done = items.filter((i) => i.done).length
  return {
    pct: Math.round((done / items.length) * 100),
    items,
    canSubmit: items.filter((i) => i.required).every((i) => i.done),
  }
}

// ---------- спецификация для радара ----------

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export function hasCyrillic(s: string): boolean {
  return /[а-яё]/i.test(s)
}

// Ключ категории: из английского названия, а если его нет — транслит русского.
export function slugify(s: string): string {
  const t = s.toLowerCase().replace(/[а-яё]/g, (c) => TRANSLIT[c] ?? '')
  return t.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '_').slice(0, 32) || 'field'
}

function uniqLower(arr: string[]): string[] {
  return [...new Set(arr.map((t) => t.trim().toLowerCase()).filter(Boolean))]
}

export function buildBotSpec(r: ExpansionRequest) {
  const d = r.data
  return {
    field: { slug: slugify(r.field_en), ru: r.field_ru, en: r.field_en },
    // Врачи заполняют по-русски; всё, где есть кириллица, перед вставкой в радар нужно перевести.
    needs_translation: [
      r.field_en ? '' : r.field_ru, ...d.subareas.flatMap((s) => [s.name_en ? '' : s.name_ru, ...s.terms]),
      ...d.conditions, ...d.interventions, ...d.exclude, ...d.keywords_ru,
    ].some(hasCyrillic),
    categories: d.subareas
      .filter((s) => s.name_ru.trim())
      .map((s) => ({
        key: slugify(s.name_en || s.name_ru),
        label_ru: s.name_ru.trim(),
        label_en: s.name_en.trim() || null,
        priority: s.priority,
        terms_ru: uniqLower(s.terms.filter(hasCyrillic)),
        terms_en: uniqLower(s.terms.filter((t) => !hasCyrillic(t))),
      })),
    conditions: uniqLower(d.conditions),
    interventions: uniqLower(d.interventions),
    keywords_ru: uniqLower(d.keywords_ru),
    keywords_en: uniqLower(d.keywords_en),
    exclude: uniqLower(d.exclude),
    study_types: d.study_types,
    phases: d.phases,
    age_groups: d.age_groups,
    known_sponsors: d.sponsors.map((s) => s.trim()).filter(Boolean),
    example_ncts: d.example_ncts.map((s) => s.trim().toUpperCase()).filter(Boolean),
    site: {
      institution: d.institution, department: d.department, city: d.city,
      patients_per_month: d.patients_per_month, trial_experience: d.trial_experience,
      gcp_doctors: d.gcp_doctors, infrastructure: d.infrastructure,
    },
    request_id: r.id,
    generated_at: new Date().toISOString(),
  }
}

// Готовый фрагмент для CATEGORY_RULES в scripts/sync_to_db.mjs и для CATEGORIES в types.ts.
export function buildCategoryRulesSnippet(r: ExpansionRequest): string {
  const spec = buildBotSpec(r)
  const rules = spec.categories
    .map((c) => {
      const en = c.terms_en.length ? JSON.stringify(c.terms_en) : '[]'
      const todo = c.terms_ru.length ? `  // TODO перевести: ${c.terms_ru.join(', ')}` : ''
      return `  ['${c.key}', ${en}],${todo}`
    })
    .join('\n')
  const labels = spec.categories
    .map((c) => `  ${c.key}: '${c.label_ru.replace(/'/g, "\\'")}',`)
    .join('\n')
  return [
    `// ${spec.field.ru}${spec.field.en ? ` (${spec.field.en})` : ' (англ. название — перевести)'} — из заявки ${r.id}`,
    spec.needs_translation ? `// Термины врачи писали по-русски: строки с TODO перевести на английский перед вставкой.` : '',
    `// scripts/sync_to_db.mjs → CATEGORY_RULES`,
    rules,
    ``,
    `// src/lib/types.ts → CATEGORIES`,
    labels,
    ``,
    `// заболевания: ${spec.conditions.join(', ') || '—'}`,
    `// ключевые слова: ${[...spec.keywords_ru, ...spec.keywords_en].join(', ') || '—'}`,
    `// исключить: ${spec.exclude.join(', ') || '—'}`,
    `// example NCTs для калибровки: ${spec.example_ncts.join(', ') || '—'}`,
  ].filter((l) => l !== '').join('\n')
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return ''
  const d = new Date(s)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
