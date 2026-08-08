#!/usr/bin/env node
// Синхронизация выхлопа бота (out/latest.json) в Supabase + формирование
// еженедельного выпуска (digest). Запускается в GitHub Actions ПОСЛЕ шага бота.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (только в Actions Secrets!)
// Аргумент: путь к latest.json (по умолчанию out/latest.json)
//
// Контракт полей от бота (все опциональны, кроме nct/title):
//   nct, title, title_ru, summary, summary_ru, status, phase, sponsor,
//   countries[], conditions[], url, posted, category
// Если бот не проставил category — деривация ниже (та же логика, что в радаре,
// плюс фарм-категории для арритмологии).

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

function deriveCategory(lead) {
  const hay = [lead.title, ...(lead.conditions ?? []), lead.summary ?? '']
    .filter(Boolean).join(' ').toLowerCase()
  for (const [cat, terms] of CATEGORY_RULES) {
    if (terms.some((t) => hay.includes(t))) return cat
  }
  return 'devices'
}

function normStatus(s) {
  return String(s ?? '').trim()
}

function isUpcoming(status) {
  return /not[_ ]?yet[_ ]?recruiting/i.test(status)
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

  const rows = leads
    .filter((l) => l.nct && l.title)
    .map((l) => {
      const status = normStatus(l.status)
      return {
        nct_id: String(l.nct),
        title: String(l.title),
        title_ru: l.title_ru ? String(l.title_ru) : null,
        summary_ru: String(l.summary_ru ?? l.summary ?? ''),
        category: String(l.category ?? deriveCategory(l)),
        recruitment_status: status,
        is_upcoming: isUpcoming(status),
        sponsor: l.sponsor ? String(l.sponsor) : null,
        phase: l.phase ? String(l.phase) : null,
        countries: Array.isArray(l.countries) ? l.countries : [],
        conditions: Array.isArray(l.conditions) ? l.conditions : [],
        score: Number.isFinite(Number(l.score)) ? Number(l.score) : null,
        score_reasons: Array.isArray(l.score_reasons) ? l.score_reasons
          : Array.isArray(l.why) ? l.why
          : (typeof l.why === 'string' && l.why ? [l.why] : []),
        source_url: String(l.url ?? `https://clinicaltrials.gov/study/${l.nct}`),
        first_posted: l.posted || l.first_posted || null,
        last_updated_at: new Date().toISOString(),
        raw: l,
      }
    })

  // Upsert по nct_id — ничего не удаляем, статусы обновляются, история живёт.
  const { data: upserted, error: upErr } = await db
    .from('trials')
    .upsert(rows, { onConflict: 'nct_id' })
    .select('id, nct_id, is_upcoming, first_posted, score')
  if (upErr) throw upErr
  console.log(`Upsert в trials: ${upserted.length}`)

  // Выпуск недели: только отборное — топ-15 актуальных + топ-5 будущих по баллу.
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
  const current = upserted.filter((t) => !t.is_upcoming).sort(byScore).slice(0, TOP_CURRENT)
  const upcoming = upserted.filter((t) => t.is_upcoming).sort(byScore).slice(0, TOP_UPCOMING)
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
  console.log(`::notice::Digest ${week} — current ${cur}, upcoming ${upc}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
