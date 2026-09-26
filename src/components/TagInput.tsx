import { useState } from 'react'

interface Props {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  hint?: string
  disabled?: boolean
  mono?: boolean
  // Быстрые подсказки — по клику добавляются в список
  suggestions?: string[]
  transform?: (s: string) => string
}

// Поле для списка терминов: Enter, запятая или точка с запятой добавляют
// элемент; вставка из буфера режется по тем же разделителям и переносам строк.
export default function TagInput({ value, onChange, placeholder, hint, disabled, mono, suggestions, transform }: Props) {
  const [draft, setDraft] = useState('')

  function add(raw: string) {
    const parts = raw.split(/[,;\n]+/).map((s) => (transform ? transform(s.trim()) : s.trim())).filter(Boolean)
    if (!parts.length) return
    const next = [...value]
    for (const p of parts) if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p)
    onChange(next)
  }

  function commit() {
    if (draft.trim()) { add(draft); setDraft('') }
  }

  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i))
  }

  const pending = (suggestions ?? []).filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))

  return (
    <div className="flex flex-col gap-1.5">
      <div className={`flex flex-wrap gap-1.5 items-center rounded-xl border border-[var(--line)] bg-[var(--panel)] px-2.5 py-2 min-h-[42px] focus-within:border-[var(--teal)] ${disabled ? 'opacity-70' : ''}`}>
        {value.map((v, i) => (
          <span key={`${v}-${i}`}
            className={`text-[12px] pl-2.5 pr-1 py-0.5 rounded-full border border-[var(--line)] bg-[var(--card)] flex items-center gap-1 ${mono ? 'mono' : ''}`}>
            {v}
            {!disabled && (
              <button type="button" onClick={() => remove(i)} aria-label={`Убрать ${v}`}
                className="w-4 h-4 leading-none rounded-full hover:bg-[var(--panel)]" style={{ color: 'var(--muted)' }}>×</button>
            )}
          </span>
        ))}
        {!disabled && (
          <input value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); commit() }
              if (e.key === 'Backspace' && !draft && value.length) remove(value.length - 1)
            }}
            onBlur={commit}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text')
              if (/[,;\n]/.test(text)) { e.preventDefault(); add(text) }
            }}
            placeholder={value.length ? '' : placeholder}
            className={`flex-1 min-w-[140px] bg-transparent text-[13px] focus:outline-none ${mono ? 'mono' : ''}`} />
        )}
      </div>
      {(hint || pending.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {hint && <span className="text-[11px] text-[var(--muted)]">{hint}</span>}
          {!disabled && pending.slice(0, 8).map((s) => (
            <button key={s} type="button" onClick={() => add(s)}
              className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-[var(--line)] text-[var(--muted)] hover:border-[var(--teal)] hover:text-[var(--teal)]">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
