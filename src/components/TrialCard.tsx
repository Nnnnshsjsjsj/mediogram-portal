import { useState } from 'react'
import type { Decision, Trial } from '../lib/types'
import { CATEGORIES, scoreColor, scoreLabel, statusColor, statusLabel } from '../lib/types'

interface Props {
  trial: Trial
  decision?: Decision
  watched?: boolean
  mode: 'triage' | 'upcoming' | 'readonly'
  onDecide?: (status: 'accepted' | 'rejected' | 'deferred') => void
  onToggleWatch?: (on: boolean) => void
}

export default function TrialCard({ trial, decision, watched, mode, onDecide, onToggleWatch }: Props) {
  const [open, setOpen] = useState(false)
  const title = trial.title_ru || trial.title
  const sc = trial.score

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        {sc != null && (
          <span className="mono text-[12px] font-semibold px-2 py-0.5 rounded-lg"
            title={scoreLabel(sc)}
            style={{ color: '#040810', background: scoreColor(sc) }}>
            {sc >= 85 ? '🔥 ' : ''}{sc}
          </span>
        )}
        <span className="mono text-[11px] text-[var(--muted)]">{trial.nct_id}</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--line)] text-[var(--muted)]">
          {CATEGORIES[trial.category] ?? trial.category}
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium"
          style={{ color: statusColor(trial.recruitment_status), border: `1px solid ${statusColor(trial.recruitment_status)}` }}>
          {statusLabel(trial.recruitment_status)}
        </span>
        {trial.phase && trial.phase !== 'NA' && (
          <span className="mono text-[11px] text-[var(--muted)]">{trial.phase}</span>
        )}
      </header>

      <h3 className="text-[15px] font-semibold leading-snug">{title}</h3>

      <p className={`text-[13px] leading-relaxed text-[var(--muted)] ${open ? 'whitespace-pre-line' : 'line-clamp-3'}`}>
        {trial.summary_ru || '—'}
      </p>

      {open && (
        <div className="text-[13px] text-[var(--muted)] flex flex-col gap-2.5 border-t border-[var(--line)] pt-3">
          {sc != null && trial.score_reasons?.length > 0 && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 flex flex-col gap-1.5">
              <span className="text-[11px] uppercase tracking-wide font-semibold"
                style={{ color: scoreColor(sc) }}>
                Почему {sc} баллов
              </span>
              {trial.score_reasons.map((r, i) => (
                <div key={i} className="flex gap-2 leading-snug">
                  <span style={{ color: scoreColor(sc) }}>•</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          )}
          {trial.sponsor && <div><span className="text-[var(--text)]">Спонсор:</span> {trial.sponsor}</div>}
          {trial.conditions.length > 0 && <div><span className="text-[var(--text)]">Состояния:</span> {trial.conditions.join(', ')}</div>}
          {trial.countries.length > 0 && <div><span className="text-[var(--text)]">Страны:</span> {trial.countries.slice(0, 10).join(', ')}{trial.countries.length > 10 ? '…' : ''}</div>}
          <a href={trial.source_url} target="_blank" rel="noreferrer" className="text-[var(--teal)] hover:underline">
            Открыть на ClinicalTrials.gov ↗
          </a>
        </div>
      )}

      <footer className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setOpen(!open)}
          className="text-[12px] text-[var(--teal)] hover:underline mr-auto">
          {open ? 'Свернуть' : 'Подробнее'}
        </button>

        {mode === 'triage' && onDecide && (
          <>
            <TriageBtn label="Отклонить" color="var(--red)" active={decision?.status === 'rejected'} onClick={() => onDecide('rejected')} />
            <TriageBtn label="Отложить" color="var(--amber)" active={decision?.status === 'deferred'} onClick={() => onDecide('deferred')} />
            <TriageBtn label="Принять" color="var(--green)" active={decision?.status === 'accepted'} onClick={() => onDecide('accepted')} />
          </>
        )}

        {mode === 'upcoming' && onToggleWatch && (
          <button onClick={() => onToggleWatch(!watched)}
            className="text-[13px] px-4 py-2 rounded-xl border transition-colors"
            style={watched
              ? { borderColor: 'var(--teal)', color: 'var(--teal)', background: 'rgba(0,194,199,0.08)' }
              : { borderColor: 'var(--line)', color: 'var(--muted)' }}>
            {watched ? '✓ Слежу' : 'Следить'}
          </button>
        )}
      </footer>
    </article>
  )
}

function TriageBtn({ label, color, active, onClick }: { label: string; color: string; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="text-[13px] px-3.5 py-2 rounded-xl border font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[var(--teal)]"
      style={active
        ? { borderColor: color, color: '#040810', background: color }
        : { borderColor: 'var(--line)', color }}>
      {label}
    </button>
  )
}
