import { useState } from 'react'
import type { ContactPerson, TrialContacts, Trial } from '../lib/types'
import { SPONSOR_CLASS, contactWays, roleLabel } from '../lib/types'

interface Props {
  trial: Trial
  contacts?: TrialContacts
  refreshing?: boolean
  error?: string
  onRefresh: () => void
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return ''
  // ClinicalTrials.gov отдаёт и «2026-03», и «2026-03-14».
  const [y, m, day] = d.split('-')
  const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
  const mon = MON[Number(m) - 1]
  if (!y) return d
  if (!mon) return y
  return day ? `${Number(day)} ${mon} ${y}` : `${mon} ${y}`
}

function fmtAge(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  return `${days} дн. назад`
}

// Текстовый блок для буфера обмена — чтобы вставить в письмо или в CRM.
function asText(trial: Trial, c: TrialContacts): string {
  const lines = [
    `${trial.nct_id} — ${trial.title_ru || trial.title}`,
    trial.source_url,
    '',
    `Спонсор: ${c.lead_sponsor ?? '—'}`,
  ]
  if (c.collaborators.length) lines.push(`Соисполнители: ${c.collaborators.join(', ')}`)
  if (c.responsible_party) lines.push(`Ответственная сторона: ${c.responsible_party}`)
  if (c.central_contacts.length) {
    lines.push('', 'Контакты спонсора:')
    for (const p of c.central_contacts) {
      lines.push(`  ${[p.name, roleLabel(p.role)].filter(Boolean).join(' — ')}`)
      if (p.email) lines.push(`    ${p.email}`)
      if (p.phone) lines.push(`    ${p.phone}${p.ext ? ` доб. ${p.ext}` : ''}`)
    }
  }
  if (c.officials.length) {
    lines.push('', 'Ответственные исследователи:')
    for (const o of c.officials) lines.push(`  ${[o.name, o.role && roleLabel(o.role), o.affiliation].filter(Boolean).join(' — ')}`)
  }
  if (c.sites.length) {
    lines.push('', 'Центры с контактами:')
    for (const s of c.sites) {
      lines.push(`  ${[s.facility, s.city, s.country].filter(Boolean).join(', ')}`)
      for (const p of s.contacts) {
        lines.push(`    ${[p.name, p.email, p.phone].filter(Boolean).join(' · ')}`)
      }
    }
  }
  return lines.join('\n')
}

export default function ContactPanel({ trial, contacts, refreshing, error, onRefresh }: Props) {
  const [copied, setCopied] = useState(false)
  const ways = contactWays(contacts)

  async function copyAll() {
    if (!contacts) return
    try {
      await navigator.clipboard.writeText(asText(trial, contacts))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* буфер недоступен — не страшно, всё видно на экране */ }
  }

  return (
    <div className="rounded-xl border p-3 flex flex-col gap-2.5"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--teal)' }}>
          Контакты спонсора
        </span>
        {contacts && (
          <span className="text-[11px] text-[var(--muted)]" title={new Date(contacts.fetched_at).toLocaleString('ru-RU')}>
            обновлено {fmtAge(contacts.fetched_at)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {ways > 0 && (
            <button onClick={copyAll} className="text-[11px] text-[var(--teal)] hover:underline">
              {copied ? '✓ Скопировано' : 'Скопировать всё'}
            </button>
          )}
          <button onClick={onRefresh} disabled={refreshing}
            className="text-[11px] text-[var(--teal)] hover:underline disabled:opacity-50">
            {refreshing ? 'Загружаю…' : 'Обновить'}
          </button>
        </div>
      </div>

      {error && <span className="text-[12px]" style={{ color: 'var(--red)' }}>{error}</span>}

      {!contacts && !refreshing && !error && (
        <span className="text-[12px] text-[var(--muted)]">
          Контакты ещё не загружены — нажмите «Обновить».
        </span>
      )}

      {contacts && (
        <>
          <div className="flex flex-col gap-1 text-[12px]">
            <Row label="Спонсор">
              <span className="text-[var(--text)] font-medium">{contacts.lead_sponsor || trial.sponsor || '—'}</span>
              {contacts.sponsor_class && SPONSOR_CLASS[contacts.sponsor_class] && (
                <span className="text-[var(--muted)]"> · {SPONSOR_CLASS[contacts.sponsor_class]}</span>
              )}
            </Row>
            {contacts.collaborators.length > 0 && (
              <Row label="Соисполнители">{contacts.collaborators.join(', ')}</Row>
            )}
            {contacts.responsible_party && (
              <Row label="Ответственная сторона">{contacts.responsible_party}</Row>
            )}
            {(contacts.enrollment != null || contacts.completion_date) && (
              <Row label="План">
                {contacts.enrollment != null ? `${contacts.enrollment} пациентов` : ''}
                {contacts.enrollment != null && contacts.completion_date ? ' · ' : ''}
                {contacts.completion_date ? `первичная точка ${fmtDate(contacts.completion_date)}` : ''}
              </Row>
            )}
            {contacts.sites_total > 0 && (
              <Row label="Центров в исследовании">
                {contacts.sites_total}
                {contacts.sites.length > 0 && ` · с прямыми контактами: ${contacts.sites.length}`}
              </Row>
            )}
          </div>

          {contacts.central_contacts.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {contacts.central_contacts.map((p, i) => (
                <PersonRow key={i} p={p} trial={trial} primary />
              ))}
            </div>
          )}

          {contacts.officials.length > 0 && (
            <div className="text-[12px] flex flex-col gap-0.5">
              <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Ответственные исследователи</span>
              {contacts.officials.map((o, i) => (
                <div key={i} className="text-[var(--text)]">
                  {o.name}
                  {o.role && <span className="text-[var(--muted)]"> — {roleLabel(o.role)}</span>}
                  {o.affiliation && <span className="text-[var(--muted)]">, {o.affiliation}</span>}
                </div>
              ))}
            </div>
          )}

          {contacts.sites.length > 0 && <SiteList sites={contacts.sites} trial={trial} />}

          {ways === 0 && (
            <span className="text-[12px] text-[var(--muted)]">
              Реестр не раскрывает прямые контакты по этому исследованию — писать через спонсора
              {contacts.lead_sponsor ? ` «${contacts.lead_sponsor}»` : ''} или через ответственного исследователя.
            </span>
          )}
        </>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-[var(--muted)]">
      <span className="text-[var(--muted)]">{label}: </span>
      <span className="text-[var(--text)]">{children}</span>
    </div>
  )
}

function PersonRow({ p, trial, primary }: { p: ContactPerson; trial: Trial; primary?: boolean }) {
  const subject = encodeURIComponent(`${trial.nct_id} — site feasibility request (Republican Scientific and Practical Centre of Cardiology, Minsk)`)
  return (
    <div className={`text-[12px] flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ${primary ? 'rounded-lg px-2 py-1.5' : ''}`}
      style={primary ? { background: 'var(--card)', border: '1px solid var(--line)' } : undefined}>
      {p.name && <span className="text-[var(--text)] font-medium">{p.name}</span>}
      {p.role && <span className="text-[var(--muted)]">{roleLabel(p.role)}</span>}
      {p.email && (
        <a href={`mailto:${p.email}?subject=${subject}`} className="mono text-[var(--teal)] hover:underline">
          {p.email}
        </a>
      )}
      {p.phone && (
        <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} className="mono text-[var(--muted)] hover:underline">
          {p.phone}{p.ext ? ` доб. ${p.ext}` : ''}
        </a>
      )}
    </div>
  )
}

function SiteList({ sites, trial }: { sites: TrialContacts['sites']; trial: Trial }) {
  const [open, setOpen] = useState(false)
  const shown = open ? sites : sites.slice(0, 3)
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Центры</span>
      {shown.map((s, i) => (
        <div key={i} className="flex flex-col gap-0.5 border-l-2 pl-2.5" style={{ borderColor: 'var(--line)' }}>
          <span className="text-[12px] text-[var(--text)]">
            {s.facility || '—'}
            <span className="text-[var(--muted)]">
              {[s.city, s.country].filter(Boolean).length ? ` · ${[s.city, s.country].filter(Boolean).join(', ')}` : ''}
            </span>
          </span>
          {s.contacts.map((p, j) => <PersonRow key={j} p={p} trial={trial} />)}
        </div>
      ))}
      {sites.length > 3 && (
        <button onClick={() => setOpen(!open)} className="self-start text-[11px] text-[var(--teal)] hover:underline">
          {open ? 'Свернуть центры' : `Ещё ${sites.length - 3}`}
        </button>
      )}
    </div>
  )
}
