#!/usr/bin/env node
// Наполнение карточек русским клиническим текстом.
//
// Зачем: бот-радар собирает данные под outreach — его summary описывает
// компанию-спонсора, а не исследование, и всё на английском. Врачу нужно
// другое. Этот скрипт берёт исследования текущего выпуска, тянет
// официальные клинические данные с ClinicalTrials.gov (открытый API, ключ
// не нужен) и просит модель собрать из них русское описание для врача.
//
// Модель НЕ придумывает факты: она получает только то, что вернул
// ClinicalTrials.gov, и структурирует это по-русски.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
//      ANTHROPIC_MODEL (необязательно), ENRICH_LIMIT (необязательно)

import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY } = process.env
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
const LIMIT = Number(process.env.ENRICH_LIMIT || 25)

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY })) {
  if (!v) { console.error(`${k} не задан`); process.exit(1) }
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const CATEGORY_RU = {
  arrhythmia: 'аритмология', structural: 'структурные вмешательства',
  hf: 'сердечная недостаточность', mcs: 'механическая поддержка кровообращения',
  antithrombotic: 'антитромботическая терапия', antiarrhythmic: 'антиаритмическая терапия',
  devices: 'устройства', other: 'другое',
}

// --- ClinicalTrials.gov: официальные клинические данные исследования ---
async function fetchCtg(nct) {
  const res = await fetch(`https://clinicaltrials.gov/api/v2/studies/${nct}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) return null
  const j = await res.json()
  const ps = j.protocolSection ?? {}
  const design = ps.designModule ?? {}
  const di = design.designInfo ?? {}
  return {
    officialTitle: ps.identificationModule?.officialTitle ?? ps.identificationModule?.briefTitle ?? '',
    briefSummary: ps.descriptionModule?.briefSummary ?? '',
    studyType: design.studyType ?? '',
    phases: design.phases ?? [],
    enrollment: design.enrollmentInfo?.count ?? null,
    allocation: di.allocation ?? '',
    interventionModel: di.interventionModel ?? '',
    primaryPurpose: di.primaryPurpose ?? '',
    masking: di.maskingInfo?.masking ?? '',
    interventions: (ps.armsInterventionsModule?.interventions ?? [])
      .slice(0, 6).map((i) => `${i.type ?? ''}: ${i.name ?? ''}`.trim()),
    primaryOutcomes: (ps.outcomesModule?.primaryOutcomes ?? [])
      .slice(0, 4).map((o) => `${o.measure ?? ''}${o.timeFrame ? ` (${o.timeFrame})` : ''}`),
  }
}

// --- Модель: собрать русское описание строго из переданных фактов ---
async function writeRussian(trial, ctg) {
  const facts = {
    nct: trial.nct_id,
    original_title: ctg?.officialTitle || trial.title,
    official_brief_summary: ctg?.briefSummary || '(нет в реестре)',
    study_type: ctg?.studyType || '',
    phase: (ctg?.phases ?? []).join(', ') || trial.phase || '',
    enrollment: ctg?.enrollment ?? null,
    allocation: ctg?.allocation || '',
    intervention_model: ctg?.interventionModel || '',
    masking: ctg?.masking || '',
    interventions: ctg?.interventions ?? [],
    primary_outcomes: ctg?.primaryOutcomes ?? [],
    recruitment_status: trial.recruitment_status,
    countries: trial.countries ?? [],
    sponsor: trial.sponsor ?? '',
    category: CATEGORY_RU[trial.category] ?? trial.category,
    radar_score: trial.score,
  }

  const system = `Ты пишешь для кардиологов из Беларуси и Восточной Европы, которые не читают по-английски. Пиши по-русски, профессиональным медицинским языком, без маркетинга.

Строгое правило: используй ТОЛЬКО факты из переданного JSON. Ничего не додумывай. Если данных для части описания нет — напиши коротко на основе того, что есть, не выдумывай числа, центры и конечные точки.

Верни ТОЛЬКО JSON без markdown и без пояснений, в формате:
{
  "title_ru": "заголовок исследования по-русски, понятный кардиологу, до 110 символов",
  "summary_ru": "Суть: ...\\nМетодология: ...\\nЗначимость: ...",
  "score_reasons": ["строка 1", "строка 2", "строка 3"]
}

title_ru — суть исследования, а не дословный перевод.
summary_ru — ровно три абзаца, разделённых переводом строки:
  Суть: что изучают и у каких пациентов.
  Методология: дизайн, рандомизация/ослепление, число пациентов, первичная конечная точка.
  Значимость: почему результат может повлиять на практику.
score_reasons — 3-5 коротких строк: почему исследование получило балл ${facts.radar_score}. Опирайся на статус набора, фазу, страны центров, спонсора и попадание в профиль (${facts.category}). Каждая строка — до 100 символов.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: 'user', content: JSON.stringify(facts, null, 1) }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  const clean = text.replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(clean)
  if (!parsed.title_ru || !parsed.summary_ru) throw new Error('модель вернула неполный JSON')
  return {
    title_ru: String(parsed.title_ru).slice(0, 300),
    summary_ru: String(parsed.summary_ru),
    score_reasons: Array.isArray(parsed.score_reasons)
      ? parsed.score_reasons.map(String).slice(0, 6) : [],
  }
}

async function main() {
  // Берём только исследования текущего выпуска — переводить все 349 не нужно.
  const { data: digest } = await db.from('digests').select('id, week_start')
    .order('week_start', { ascending: false }).limit(1).single()
  if (!digest) { console.log('Выпусков нет — выходим.'); return }

  const { data: rows, error } = await db.from('digest_trials')
    .select('trials(*)').eq('digest_id', digest.id)
  if (error) throw error

  const pending = (rows ?? [])
    .map((r) => r.trials)
    .filter((t) => t && (!t.summary_ru || t.summary_ru.trim() === ''))
    .slice(0, LIMIT)

  console.log(`Выпуск ${digest.week_start}: без русского описания — ${pending.length}`)

  let ok = 0, failed = 0
  for (const t of pending) {
    try {
      const ctg = await fetchCtg(t.nct_id)
      let ru
      try {
        ru = await writeRussian(t, ctg)
      } catch (first) {
        console.warn(`  … ${t.nct_id}: повтор после «${first.message.slice(0, 80)}»`)
        await new Promise((r) => setTimeout(r, 1500))
        ru = await writeRussian(t, ctg)
      }
      const { error: uErr } = await db.from('trials').update({
        title_ru: ru.title_ru,
        summary_ru: ru.summary_ru,
        score_reasons: ru.score_reasons.length ? ru.score_reasons : t.score_reasons,
        last_updated_at: new Date().toISOString(),
      }).eq('id', t.id)
      if (uErr) throw uErr
      ok++
      console.log(`  ✓ ${t.nct_id} — ${ru.title_ru.slice(0, 60)}…`)
    } catch (e) {
      failed++
      console.error(`  ✗ ${t.nct_id}: ${e.message}`)
    }
    await new Promise((r) => setTimeout(r, 700)) // бережём rate limit
  }
  console.log(`Готово: переведено ${ok}, ошибок ${failed}`)
  console.log(`::notice::Enrich RU — ok ${ok}, failed ${failed}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
