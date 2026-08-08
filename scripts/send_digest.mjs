#!/usr/bin/env node
// Еженедельная рассылка выпуска врачам через Resend.
// Запускается ПОСЛЕ sync_to_db.mjs. Идемпотентна: перед отправкой проверяет
// в activity_log, не отправлялся ли выпуск этому врачу (event=digest_sent).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//      PORTAL_URL (напр. https://nnnnshsjsjsj.github.io/mediogram-portal/),
//      FROM_EMAIL (напр. "Mediogram Radar <radar@mediogram.by>")
//
// Безопасность: письмо НЕ содержит автологин-токенов (в копии коллеги) —
// только ссылку на страницу входа портала.

import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, PORTAL_URL, FROM_EMAIL } = process.env
for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, PORTAL_URL, FROM_EMAIL })) {
  if (!v) { console.error(`${k} не задан`); process.exit(1) }
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const CATEGORIES = {
  arrhythmia: 'Аритмология', structural: 'Структурные вмешательства', hf: 'Сердечная недостаточность',
  mcs: 'Мех. поддержка кровообращения', antithrombotic: 'Антитромботическая терапия',
  antiarrhythmic: 'Антиаритмическая терапия', devices: 'Устройства', other: 'Другое',
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function trialBlock(t) {
  return `
  <tr><td style="padding:14px 0;border-bottom:1px solid #1E2C46;">
    <div style="font:11px 'IBM Plex Mono',monospace;color:#8FA3C0;">${esc(t.nct_id)} · ${esc(CATEGORIES[t.category] ?? t.category)} · ${esc(t.recruitment_status)}</div>
    <div style="font:600 15px Inter,Arial;color:#E6EDF7;margin:4px 0;">${esc(t.title_ru || t.title)}</div>
    <div style="font:13px/1.5 Inter,Arial;color:#8FA3C0;">${esc((t.summary_ru || '').slice(0, 320))}${(t.summary_ru || '').length > 320 ? '…' : ''}</div>
  </td></tr>`
}

function emailHtml(doctorName, week, current, upcoming) {
  return `<!doctype html><html><body style="margin:0;background:#040810;padding:24px 12px;">
  <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;background:#070C16;border:1px solid #1E2C46;border-radius:16px;">
    <tr><td style="padding:28px 28px 8px;">
      <div style="font:700 18px Inter,Arial;color:#E6EDF7;">Mediogram · Еженедельный радар исследований</div>
      <div style="font:12px 'IBM Plex Mono',monospace;color:#00C2C7;margin-top:4px;">выпуск недели ${esc(week)}</div>
      <p style="font:14px/1.5 Inter,Arial;color:#8FA3C0;">${esc(doctorName || 'Уважаемый коллега')}, в подборке этой недели ${current.length} актуальных исследований${upcoming.length ? ` и ${upcoming.length} готовящихся к запуску` : ''}. Ключевые — ниже; полный список, фильтры и триаж — в личном кабинете.</p>
      <a href="${esc(PORTAL_URL)}" style="display:inline-block;background:#00C2C7;color:#040810;font:600 14px Inter,Arial;padding:12px 22px;border-radius:12px;text-decoration:none;margin:6px 0 18px;">Открыть кабинет и разобрать выпуск</a>
    </td></tr>
    <tr><td style="padding:0 28px;">
      <table role="presentation" width="100%">${current.slice(0, 5).map(trialBlock).join('')}</table>
      ${upcoming.length ? `
      <div style="font:600 12px Inter,Arial;color:#FFC24B;letter-spacing:.08em;text-transform:uppercase;margin-top:20px;">Скоро откроются</div>
      <table role="presentation" width="100%">${upcoming.slice(0, 3).map(trialBlock).join('')}</table>` : ''}
    </td></tr>
    <tr><td style="padding:20px 28px 28px;">
      <div style="font:11px Inter,Arial;color:#8FA3C0;">Письмо для внутреннего использования UAB Mediogram. Вход в кабинет — по персональной одноразовой ссылке, которую вы запрашиваете сами на странице входа.</div>
    </td></tr>
  </table></body></html>`
}

async function sendResend(payload) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
  return res.json()
}

async function main() {
  const { data: digest } = await db.from('digests').select('id, week_start')
    .order('week_start', { ascending: false }).limit(1).single()
  if (!digest) { console.log('Выпусков нет — выходим.'); return }

  const { data: dt } = await db.from('digest_trials')
    .select('section, rank, trials(*)').eq('digest_id', digest.id).order('rank')
  const all = (dt ?? []).map((r) => ({ ...r.trials, __section: r.section }))

  const { data: doctors } = await db.from('profiles').select('*')
    .eq('role', 'doctor').eq('is_active', true)

  // Идемпотентность: кто уже получил этот выпуск.
  const { data: sentLog } = await db.from('activity_log').select('user_id')
    .eq('event', 'digest_sent').contains('meta', { week: digest.week_start })
  const alreadySent = new Set((sentLog ?? []).map((r) => r.user_id))

  let sent = 0, skipped = 0
  for (const doc of doctors ?? []) {
    if (alreadySent.has(doc.id)) { skipped++; continue }

    const subs = doc.categories?.length ? new Set(doc.categories) : null
    const mine = all.filter((t) => !subs || subs.has(t.category))
    const current = mine.filter((t) => t.__section === 'current')
    const upcoming = mine.filter((t) => t.__section === 'upcoming')
    if (!current.length && !upcoming.length) { skipped++; continue }

    await sendResend({
      from: FROM_EMAIL,
      to: [doc.email],
      subject: `Радар исследований · неделя ${digest.week_start} · ${current.length} новых`,
      html: emailHtml(doc.full_name, digest.week_start, current, upcoming),
    })
    await db.from('activity_log').insert({
      user_id: doc.id, event: 'digest_sent',
      meta: { week: digest.week_start, current: current.length, upcoming: upcoming.length },
    })
    sent++
    await new Promise((r) => setTimeout(r, 600)) // бережём rate limit Resend
  }
  console.log(`Отправлено: ${sent}, пропущено: ${skipped}`)
  console.log(`::notice::Digest emails — sent ${sent}, skipped ${skipped}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
