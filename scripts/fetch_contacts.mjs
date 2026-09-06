#!/usr/bin/env node
// Контакты спонсора/CRO по исследованиям — из ClinicalTrials.gov в trial_contacts.
//
// Зачем: врач в портале нажимает «Принять», и дальше кто-то должен написать
// спонсору. Раньше админ видел в панели только номер NCT и шёл искать контакты
// руками. Этот скрипт складывает их в БД, а админ-панель показывает готовую
// карточку с адресами.
//
// Приоритет: сначала исследования, которые врачи уже приняли (по ним работа
// идёт прямо сейчас), затем остальной текущий выпуск — чтобы контакты были
// под рукой ещё до решения.
//
// Контакты лежат в отдельной таблице trial_contacts (RLS: только админ),
// потому что trials читают все врачи. См. supabase/migrations/003_trial_contacts.sql.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//      CONTACTS_LIMIT     — сколько исследований за прогон (по умолчанию 60)
//      CONTACTS_MAX_AGE   — через сколько дней обновлять запись (по умолчанию 14)
//      CONTACTS_SCOPE     — accepted | digest | all (по умолчанию digest:
//                           принятые + текущий выпуск)

import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
const LIMIT = Number(process.env.CONTACTS_LIMIT || 60)
const MAX_AGE_DAYS = Number(process.env.CONTACTS_MAX_AGE || 14)
const SCOPE = (process.env.CONTACTS_SCOPE || 'digest').toLowerCase()

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) { console.error(`${k} не задан`); process.exit(1) }
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// ВАЖНО: структура ответа обязана совпадать с src/lib/ctg.ts — админ-панель
// умеет обновлять контакты из браузера и пишет в ту же таблицу.
function mapStudy(json) {
  const ps = json?.protocolSection ?? {}
  const cl = ps.contactsLocationsModule ?? {}
  const sc = ps.sponsorCollaboratorsModule ?? {}
  const st = ps.statusModule ?? {}

  const person = (c) => ({
    name: c?.name ?? '',
    role: c?.role ?? '',
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    ext: c?.phoneExt ?? '',
  })
  const hasWay = (p) => Boolean(p.email || p.phone)

  const locations = Array.isArray(cl.locations) ? cl.locations : []
  // Из центров берём только те, у кого есть собственные контакты, иначе это
  // просто список адресов — он и так виден на ClinicalTrials.gov.
  const sites = locations
    .filter((l) => (l.contacts ?? []).some((c) => c?.email || c?.phone))
    .slice(0, 25)
    .map((l) => ({
      facility: l.facility ?? '',
      city: l.city ?? '',
      country: l.country ?? '',
      status: l.status ?? '',
      contacts: (l.contacts ?? []).map(person).filter(hasWay),
    }))

  const rp = sc.responsibleParty ?? {}
  const responsible = [rp.investigatorFullName, rp.investigatorTitle, rp.investigatorAffiliation]
    .filter(Boolean).join(', ') || (rp.type ? String(rp.type).replaceAll('_', ' ') : '')

  return {
    lead_sponsor: sc.leadSponsor?.name ?? null,
    sponsor_class: sc.leadSponsor?.class ?? null,
    collaborators: (sc.collaborators ?? []).map((c) => c?.name).filter(Boolean),
    responsible_party: responsible || null,
    central_contacts: (cl.centralContacts ?? []).map(person).filter(hasWay),
    officials: (cl.overallOfficials ?? []).map((o) => ({
      name: o?.name ?? '',
      affiliation: o?.affiliation ?? '',
      role: o?.role ?? '',
    })).filter((o) => o.name),
    sites,
    sites_total: locations.length,
    enrollment: ps.designModule?.enrollmentInfo?.count ?? null,
    start_date: st.startDateStruct?.date ?? null,
    completion_date: st.primaryCompletionDateStruct?.date ?? st.completionDateStruct?.date ?? null,
    last_update_posted: st.lastUpdatePostDateStruct?.date ?? null,
  }
}

async function fetchContacts(nct) {
  const url = `https://clinicaltrials.gov/api/v2/studies/${nct}`
    + '?fields=protocolSection.contactsLocationsModule'
    + ',protocolSection.sponsorCollaboratorsModule'
    + ',protocolSection.statusModule'
    + ',protocolSection.designModule'
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`ClinicalTrials.gov ${res.status}`)
  return mapStudy(await res.json())
}

// Что обновляем: принятые врачами → остальной выпуск. Внутри каждой группы
// сначала те, по кому контактов нет вообще, потом просроченные.
async function pickTrials() {
  const staleBefore = new Date(Date.now() - MAX_AGE_DAYS * 86400_000).toISOString()

  const { data: accepted, error: aErr } = await db
    .from('decisions').select('trial_id').eq('status', 'accepted')
  if (aErr) throw aErr
  const acceptedIds = [...new Set((accepted ?? []).map((d) => d.trial_id))]

  let digestIds = []
  if (SCOPE !== 'accepted') {
    const { data: digest } = await db.from('digests').select('id')
      .order('week_start', { ascending: false }).limit(1).maybeSingle()
    if (digest) {
      const { data: dt } = await db.from('digest_trials').select('trial_id').eq('digest_id', digest.id)
      digestIds = (dt ?? []).map((r) => r.trial_id)
    }
  }

  let ids = [...acceptedIds, ...digestIds.filter((id) => !acceptedIds.includes(id))]
  if (SCOPE === 'all') {
    const { data: all } = await db.from('trials').select('id').order('first_seen_at', { ascending: false })
    for (const t of all ?? []) if (!ids.includes(t.id)) ids.push(t.id)
  }
  if (!ids.length) return { rows: [], acceptedIds }

  const { data: trials, error: tErr } = await db
    .from('trials').select('id, nct_id, title').in('id', ids)
  if (tErr) throw tErr

  const { data: existing } = await db
    .from('trial_contacts').select('trial_id, fetched_at').in('trial_id', ids)
  const fetchedAt = new Map((existing ?? []).map((r) => [r.trial_id, r.fetched_at]))

  const order = new Map(ids.map((id, i) => [id, i]))
  const rows = (trials ?? [])
    .filter((t) => {
      const at = fetchedAt.get(t.id)
      return !at || at < staleBefore
    })
    .sort((a, b) => {
      const freshA = fetchedAt.has(a.id) ? 1 : 0
      const freshB = fetchedAt.has(b.id) ? 1 : 0
      return freshA - freshB || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    })
    .slice(0, LIMIT)

  return { rows, acceptedIds }
}

async function main() {
  const { rows, acceptedIds } = await pickTrials()
  console.log(`Обновляем контакты: ${rows.length} исследований (scope=${SCOPE}, старше ${MAX_AGE_DAYS} дн. или без записи)`)
  if (!rows.length) { console.log('::notice::Sponsor contacts — обновлять нечего'); return }

  let ok = 0, failed = 0, empty = 0
  const emptyAccepted = []

  for (const t of rows) {
    try {
      const c = await fetchContacts(t.nct_id)
      const { error } = await db.from('trial_contacts')
        .upsert({ trial_id: t.id, ...c, fetched_at: new Date().toISOString() }, { onConflict: 'trial_id' })
      if (error) throw error
      const ways = c.central_contacts.length + c.sites.reduce((n, s) => n + s.contacts.length, 0)
      ok++
      if (ways === 0) {
        empty++
        if (acceptedIds.includes(t.id)) emptyAccepted.push(t.nct_id)
        console.log(`  ○ ${t.nct_id} — реестр не раскрывает контакты (спонсор: ${c.lead_sponsor ?? '—'})`)
      } else {
        console.log(`  ✓ ${t.nct_id} — ${ways} контакт(ов), спонсор: ${c.lead_sponsor ?? '—'}`)
      }
    } catch (e) {
      failed++
      console.error(`::warning::${t.nct_id} — контакты не обновлены: ${String(e.message).slice(0, 200)}`)
    }
    await new Promise((r) => setTimeout(r, 400)) // бережём публичный API
  }

  console.log(`Готово: обновлено ${ok}, без контактов в реестре ${empty}, ошибок ${failed}`)
  console.log(`::notice::Sponsor contacts — ok ${ok}, без контактов ${empty}, ошибок ${failed}`)
  // Принятое исследование без контактов админ должен увидеть: по нему нужен
  // ручной поиск, иначе работа встанет на этапе «Контакт со спонсором».
  if (emptyAccepted.length) {
    console.log(`::warning::Принятые исследования без контактов в реестре: ${emptyAccepted.join(', ')}`)
  }
  // Падаем, только если не удалось вообще ничего — иначе один недоступный
  // NCT красит весь еженедельный прогон в красный.
  if (ok === 0 && failed > 0) {
    console.error('::error::Ни одно исследование не обновилось — проверьте доступность ClinicalTrials.gov')
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
