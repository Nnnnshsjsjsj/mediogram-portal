import type { WorkStage } from '../lib/types'
import { STAGES, STAGE_ORDER } from '../lib/types'

interface Props {
  stage: WorkStage | null
  editable?: boolean
  onSetStage?: (s: WorkStage) => void
  compact?: boolean
}

/**
 * Трек этапов в стиле отслеживания доставки: линия с точками.
 * Врач видит прогресс (read-only), админ может кликать по точкам.
 */
export default function StageTracker({ stage, editable, onSetStage, compact }: Props) {
  const activeIdx = STAGE_ORDER.indexOf(stage ?? 'interest')
  const pct = (activeIdx / (STAGE_ORDER.length - 1)) * 100

  return (
    <div className="w-full select-none">
      <div className="relative" style={{ height: compact ? 22 : 26 }}>
        {/* базовая линия */}
        <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-[3px] rounded-full"
          style={{ background: 'var(--line)' }} />
        {/* заполненная часть */}
        <div className="absolute left-2 top-1/2 -translate-y-1/2 h-[3px] rounded-full track-fill"
          style={{ width: `calc(${pct}% - ${pct * 0.04}px)`, background: 'var(--teal)' }} />
        {/* точки */}
        <div className="absolute inset-0 flex items-center justify-between px-0.5">
          {STAGE_ORDER.map((s, i) => {
            const state = i < activeIdx ? 'done' : i === activeIdx ? 'current' : 'todo'
            const size = state === 'current' ? (compact ? 14 : 16) : (compact ? 10 : 12)
            return (
              <button key={s} type="button" disabled={!editable}
                onClick={() => editable && onSetStage?.(s)}
                title={STAGES[s]}
                aria-label={STAGES[s]}
                className={`rounded-full border-2 transition-all ${editable ? 'cursor-pointer hover:scale-125' : 'cursor-default'} ${state === 'current' ? 'dot-current' : ''}`}
                style={{
                  width: size, height: size,
                  background: state === 'todo' ? 'var(--card)' : 'var(--teal)',
                  borderColor: state === 'todo' ? 'var(--line-strong)' : 'var(--teal)',
                }} />
            )
          })}
        </div>
      </div>
      {/* подписи */}
      <div className="flex justify-between mt-1">
        {STAGE_ORDER.map((s, i) => (
          <span key={s}
            className={`text-[10px] leading-tight ${compact ? 'max-w-[52px]' : 'max-w-[64px]'} text-center first:text-left last:text-right`}
            style={{
              color: i === activeIdx ? 'var(--teal)' : 'var(--muted)',
              fontWeight: i === activeIdx ? 600 : 400,
            }}>
            {STAGES[s]}
          </span>
        ))}
      </div>
    </div>
  )
}
