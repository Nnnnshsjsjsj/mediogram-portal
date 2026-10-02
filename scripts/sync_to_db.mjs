#!/usr/bin/env node
// Синхронизация выхлопа бота (out/latest.json) в Supabase + формирование
// еженедельного выпуска (digest). Запускается в GitHub Actions ПОСЛЕ шага бота.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (только в Actions Secrets!)
// Аргумент: путь к latest.json (по умолчанию out/latest.json)
//
// Контракт полей от бота (все опциональны, кроме nct/title):
//   nct, title, title_ru, summary, summary_ru, status, phase, sponsor,
//   countries[], conditions[], url, posted, category, source, field
// Если бот не проставил category — деривация ниже (та же логика, что в радаре,
// плюс фарм-категории для арритмологии; для онкологии — по локализации опухоли).
// field (радар v8): cardiology | oncology. Нет поля — значит кардиология.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const CATEGORY_RULES = [
  ['antithrombotic', ['anticoagul', 'antithrombotic', 'antiplatelet', 'apixaban', 'rivaroxaban',
    'dabigatran', 'edoxaban', 'warfarin', 'factor xi', 'asundexian', 'abelacimab', 'milvexian']],
  ['antiarrhythmic', ['antiarrhythmic', 'amiodarone', 'flecainide', 'sotalol', 'dronedarone',
    'rhythm control drug', 'etripamil', 'rate control']],
  ['mcs', ['mechanical circulatory', 'ventricular assist', 'lvad', 'impella', 'cardiogenic shock', 'iabp', 'ecmo']],
  ['arrhythmia', ['atrial fibrillation', 'atrial flutter', 'ventricular tachycardia', 'supraventricular',
    'arrhythmia', 'ablation', 'pulsed field', 'pfa', 'cryoablation', 'pulmonary vein', 'electrophysiology',
    'mapping', 'pacemaker', 'defibrillator', 'icd', 'resynchronization', 'crt', 'bradycardia', 'electroanatomic']],
  ['structural', ['aortic valve', 'mitral', 'tricuspid', 'mitraclip', 'triclip', 'tavr', 'tavi',
    'transcatheter valve', 'transcatheter aortic', 'transcatheter mitral', 'left atrial appendage', 'laa',
    'appendage occlusion', 'septal occluder', 'interatrial shunt', 'regurgitation']],
  ['hf', ['heart failure', 'hfpef', 'hfref', 'cardiomyopathy', 'myocardial regeneration', 'ejection fraction']],
]

// Онкология: категория = локализация опухоли. Порядок важен — первое совпадение.
const ONCOLOGY_CATEGORY_RULES = [
  ['onc_breast', ['breast']],
  ['onc_lung', ['lung', 'nsclc', 'sclc', 'mesothelioma']],
  ['onc_uro', ['prostate', 'bladder', 'urothelial', 'renal cell', 'kidney cancer', 'testicular', 'penile']],
  ['onc_gyn', ['ovarian', 'cervical', 'cervix', 'endometrial', 'uterine', 'vulvar', 'fallopian', 'peritoneal']],
  ['onc_gi', ['colorectal', 'colon', 'rectal', 'gastric', 'stomach', 'esophag', 'oesophag', 'gastroesophageal',
    'pancrea', 'hepatocellular', 'liver cancer', 'biliary', 'cholangio', 'gallbladder', 'anal cancer',
    'gastrointestinal', 'abdominal']],
]

const KNOWN_FIELDS = new Set(['cardiology', 'oncology'])

function fieldOf(lead) {
  return String(lead.field ?? 'cardiology').toLowerCase()
}

function deriveCategory(lead) {
  const hay = [lead.title, ...(lead.conditions ?? []), lead.summary ?? '']
    .filter(Boolean).join(' ').toLowerCase()
  const oncology = fieldOf(lead) === 'oncology'
  for (const [cat, terms] of oncology ? ONCOLOGY_CATEGORY_RULES : CATEGORY_RULES) {
    if (terms.some((t) => hay.includes(t))) return cat
  }
  return oncology ? 'onc_other' : 'devices'
}

function normStatus(s) {
  return String(s ?? '').trim()
}

function isUpcoming(status) {
  return /not[_ ]?yet[_ ]?recruiting/i.test(status)
}

// Источники, которые портал принимает. Радар v7 собирает ещё EU CTIS и openFDA,
// но портал к ним не готов: у CTIS статус приходит числовым кодом («CTIS status 8»),
// балл у этих записей не откалиброван (почти все 95 и вытесняют CT.gov из выпуска),
// а enrich_ru.mjs и fetch_contacts.mjs ходят в ClinicalTrials.gov по nct_id.
// FDA 510(k)/PMA — это вообще не исследования, а разрешения на изделия.
// Переопределяется через env: PORTAL_SOURCES=ctgov,ctis
const ALLOWED_SOURCES = new Set(
  String(process.env.PORTAL_SOURCES ?? 'ctgov').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
)

// Бот может не проставить source — тогда определяем по формату идентификатора.
function sourceOf(lead) {
  if (lead.source) return String(lead.source).toLowerCase()
  const id = String(lead.nct ?? '')
  if (/^NCT\d{8}$/i.test(id)) return 'ctgov'
  if (/^\d{4}-\d{6}-\d{2}-\d{2}$/.test(id)) return 'ctis'
  return 'fda'
}

// Понедельник текущей недели (UTC) — ключ выпуска.
function mondayOfThisWeek() {
  const d = new Date()
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() - day + 1)
  return d.toISOString().slice(0, 10)
}

async function main() {
  const path = process.argv[2] ?? 'out/latest.json'
  const latest = JSON.parse(readFileSync(path, 'utf-8'))
  const leads = Array.isArray(latest.leads) ? latest.leads : []
  console.log(`Прочитано лидов: ${leads.length}`)

  const bySource = {}, byField = {}
  for (const l of leads) {
    const src = sourceOf(l); bySource[src] = (bySource[src] ?? 0) + 1
    const f = fieldOf(l); byField[f] = (byField[f] ?? 0) + 1
  }
  console.log(`По источникам: ${JSON.stringify(bySource)}; принимаем: ${[...ALLOWED_SOURCES].join(', ')}`)
  console.log(`По направлениям: ${JSON.stringify(byField)}`)
  const unknown = Object.keys(byField).filter((f) => !KNOWN_FIELDS.has(f))
  if (unknown.length) console.log(`::warning::Радар прислал неизвестные направления ${unknown.join(', ')} — пропускаем`)

  const rows = leads
    .filter((l) => l.nct && l.title)
    .filter((l) => ALLOWED_SOURCES.has(sourceOf(l)))
    .filter((l) => KNOWN_FIELDS.has(fieldOf(l)))
    .map((l) => {
      const status = normStatus(l.status)
      return {
        nct_id: String(l.nct),
        title: String(l.title),
        field: fieldOf(l),
        // title_ru / summary_ru / score_reasons пишет только enrich_ru.mjs.
        category: String(l.category ?? deriveCategory(l)),
        recruitment_status: status,
        is_upcoming: isUpcoming(status),
        sponsor: l.sponsor ? String(l.sponsor) : null,
        phase: l.phase ? String(l.phase) : null,
        countries: Array.isArray(l.countries) ? l.countries : [],
        conditions: Array.isArray(l.conditions) ? l.conditions : [],
        score: Number.isFinite(Number(l.score)) ? Number(l.score) : null,
        source_url: String(l.url ?? `https://clinicaltrials.gov/study/${l.nct}`),
        first_posted: l.posted || l.first_posted || null,
        last_updated_at: new Date().toISOString(),
        // ВАЖНО: в raw кладём только клинические поля.
        // Контакты и outreach-тексты (email, phone, contact_name, pi, opener,
        // angle, who, channel) НЕ попадают в БД — trials читают все врачи.
        raw: {
          tier: l.tier ?? null,
          modality: l.modality ?? null,
          region_sites: Array.isArray(l.region_sites) ? l.region_sites : [],
        },
      }
    })

  // Upsert по nct_id — ничего не удаляем, статусы обновляются, история живёт.
  const { data: upserted, error: upErr } = await db
    .from('trials')
    .upsert(rows, { onConflict: 'nct_id' })
    .select('id, nct_id, field, is_upcoming, first_posted, score')
  if (upErr) throw upErr
  console.log(`Upsert в trials: ${upserted.length}`)

  // Выпуск недели: только отборное — по каждому направлению свои
  // топ-15 актуальных + топ-5 будущих по баллу. Выпуск один на неделю,
  // фронт и рассылка делят его по trials.field.
  const TOP_CURRENT = 15
  const TOP_UPCOMING = 5
  const week = mondayOfThisWeek()
  const { data: digest, error: dErr } = await db
    .from('digests')
    .upsert({ week_start: week }, { onConflict: 'week_start' })
    .select('id').single()
  if (dErr) throw dErr

  const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1)
    || String(b.first_posted ?? '').localeCompare(String(a.first_posted ?? ''))
  const current = [], upcoming = []
  const perField = {}
  for (const f of KNOWN_FIELDS) {
    const mine = upserted.filter((t) => (t.field ?? 'cardiology') === f)
    const c = mine.filter((t) => !t.is_upcoming).sort(byScore).slice(0, TOP_CURRENT)
    const u = mine.filter((t) => t.is_upcoming).sort(byScore).slice(0, TOP_UPCOMING)
    current.push(...c); upcoming.push(...u)
    perField[f] = `${c.length}+${u.length}`
  }
  console.log(`Выпуск по направлениям (актуальные+будущие): ${JSON.stringify(perField)}`)
  const dt = [...current, ...upcoming].map((t, i) => ({
    digest_id: digest.id,
    trial_id: t.id,
    section: t.is_upcoming ? 'upcoming' : 'current',
    rank: i,
  }))

  // Пересобираем выпуск начисто, чтобы не копить хвосты прошлых прогонов.
  const { error: delErr } = await db.from('digest_trials').delete().eq('digest_id', digest.id)
  if (delErr) throw delErr
  const { error: dtErr } = await db.from('digest_trials').insert(dt)
  if (dtErr) throw dtErr

  console.log(`Выпуск ${week}: current=${current.length}, upcoming=${upcoming.length} (отобрано из ${upserted.length})`)
  // Строка для Slack-репорта в workflow:
  console.log(`::notice::Digest ${week} — current ${current.length}, upcoming ${upcoming.length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
