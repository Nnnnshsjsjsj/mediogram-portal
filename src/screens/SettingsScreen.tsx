import { useState } from 'react'
import { updateMyProfile } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { CATEGORIES } from '../lib/types'

export default function SettingsScreen({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [name, setName] = useState(profile.full_name)
  const [specialty, setSpecialty] = useState(profile.specialty ?? '')
  const [cats, setCats] = useState<Set<string>>(new Set(profile.categories))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    setSaving(true); setSaved(false)
    const categories = [...cats]
    try {
      await updateMyProfile({ full_name: name, specialty, categories })
      onSaved({ ...profile, full_name: name, specialty, categories })
      setSaved(true)
    } finally { setSaving(false) }
  }

  function toggle(k: string) {
    const n = new Set(cats)
    n.has(k) ? n.delete(k) : n.add(k)
    setCats(n)
  }

  return (
    <div className="flex flex-col gap-5 max-w-xl">
      <h1 className="text-lg font-semibold">Настройки</h1>

      <Field label="Имя и фамилия">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>

      <Field label="Специальность">
        <input value={specialty} onChange={(e) => setSpecialty(e.target.value)}
          placeholder="например, аритмология" className={inputCls} />
      </Field>

      <Field label="Мои категории" hint="Выберите направления, которые хотите получать. Если ничего не выбрано — приходят все категории.">
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(CATEGORIES).map(([k, label]) => (
            <button key={k} onClick={() => toggle(k)}
              className="text-[12px] px-3 py-1.5 rounded-full border transition-colors"
              style={cats.has(k)
                ? { borderColor: 'var(--teal)', color: 'var(--teal)', background: 'rgba(0,194,199,0.08)' }
                : { borderColor: 'var(--line)', color: 'var(--muted)' }}>
              {label}
            </button>
          ))}
        </div>
      </Field>


      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="px-5 py-2.5 rounded-xl font-semibold text-[13px] transition-opacity disabled:opacity-50"
          style={{ background: 'var(--teal)', color: 'var(--on-accent)' }}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        {saved && <span className="text-[12px] text-[var(--green)]">Сохранено</span>}
      </div>

      <div className="border-t border-[var(--line)] pt-4">
        <button onClick={() => supabase.auth.signOut()} className="text-[13px] text-[var(--muted)] hover:text-[var(--red)]">
          Выйти из аккаунта
        </button>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3.5 py-2.5 text-[14px] ' +
  'placeholder:text-[var(--muted)]/50 focus:outline-none focus:border-[var(--teal)]'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--muted)]/70">{hint}</span>}
    </label>
  )
}
