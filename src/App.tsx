import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { getMyProfile, logEvent } from './lib/api'
import type { Profile } from './lib/types'
import TriageScreen from './screens/TriageScreen'
import DecisionsScreen from './screens/DecisionsScreen'
import SettingsScreen from './screens/SettingsScreen'
import AdminScreen from './admin/AdminScreen'

type Tab = 'triage' | 'decisions' | 'settings' | 'admin'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tab, setTab] = useState<Tab>('triage')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN') logEvent('login')
      if (event === 'SIGNED_OUT') setProfile(null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) getMyProfile().then(setProfile).catch(console.error)
  }, [session])

  if (!authReady) return <FullScreen><Spinner text="Проверка сессии…" /></FullScreen>
  if (!session) return <LoginScreen />
  if (!profile) return <FullScreen><Spinner text="Загрузка профиля…" /></FullScreen>

  const isAdmin = profile.role === 'admin'
  const tabs: { id: Tab; label: string }[] = [
    { id: 'triage', label: 'Триаж' },
    { id: 'decisions', label: 'Мои решения' },
    { id: 'settings', label: 'Настройки' },
    ...(isAdmin ? [{ id: 'admin' as Tab, label: 'Админ' }] : []),
  ]

  return (
    <div className="min-h-[100dvh] bg-[var(--bg)]">
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--panel)]/85 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 h-14 flex items-center gap-5">
          <div className="flex items-center gap-2">
            <RadarMark />
            <span className="font-semibold text-[14px]">Mediogram Portal</span>
          </div>
          <nav className="flex gap-1 ml-auto">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className="px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors"
                style={tab === t.id ? { color: 'var(--teal)', background: 'rgba(0,194,199,0.08)' } : { color: 'var(--muted)' }}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 pb-24">
        {tab === 'triage' && <TriageScreen profile={profile} />}
        {tab === 'decisions' && <DecisionsScreen />}
        {tab === 'settings' && <SettingsScreen profile={profile} onSaved={setProfile} />}
        {tab === 'admin' && isAdmin && <AdminScreen />}
      </main>
    </div>
  )
}

function LoginScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function sendLink() {
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin + import.meta.env.BASE_URL,
        shouldCreateUser: false, // регистрация закрыта: аккаунты создаёт админ
      },
    })
    setBusy(false)
    if (error) setErr(error.message.includes('Signups not allowed') || error.message.includes('signups')
      ? 'Этот email не зарегистрирован. Обратитесь к администратору Mediogram.'
      : error.message)
    else setSent(true)
  }

  return (
    <FullScreen>
      <div className="w-full max-w-sm rounded-3xl border border-[var(--line)] bg-[var(--card)] p-7 flex flex-col gap-5 rise" style={{ boxShadow: "var(--shadow)" }}>
        <div className="flex items-center gap-2.5">
          <RadarMark size={30} />
          <div>
            <div className="font-semibold">Mediogram Portal</div>
            <div className="mono text-[11px] text-[var(--muted)]">триаж клинических исследований</div>
          </div>
        </div>

        {sent ? (
          <div className="flex flex-col gap-2">
            <p className="text-[14px]">Ссылка для входа отправлена на <span className="mono text-[var(--teal)]">{email}</span>.</p>
            <p className="text-[12px] text-[var(--muted)]">Откройте письмо и нажмите кнопку — ссылка одноразовая и действует 15 минут.</p>
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium uppercase tracking-wide text-[var(--muted)]">Рабочий email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && sendLink()}
                type="email" placeholder="doctor@clinic.by" autoFocus
                className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3.5 py-2.5 text-[14px] focus:outline-none focus:border-[var(--teal)]" />
            </label>
            <button onClick={sendLink} disabled={busy || !email.includes('@')}
              className="rounded-xl py-2.5 font-semibold text-[14px] disabled:opacity-40"
              style={{ background: 'var(--teal)', color: 'var(--on-accent)' }}>
              {busy ? 'Отправка…' : 'Получить ссылку для входа'}
            </button>
            {err && <p className="text-[12px]" style={{ color: 'var(--red)' }}>{err}</p>}
            <p className="text-[11px] text-[var(--muted)]">Без паролей: на почту придёт персональная одноразовая ссылка.</p>
          </>
        )}
      </div>
    </FullScreen>
  )
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] flex items-center justify-center px-4 bg-[var(--bg)]">{children}</div>
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <svg width="56" height="56" viewBox="0 0 72 72" style={{ animation: 'spin 3s linear infinite' }}>
        <circle cx="36" cy="36" r="34" fill="none" stroke="var(--line)" strokeWidth="1" />
        <circle cx="36" cy="36" r="22" fill="none" stroke="var(--line)" strokeWidth="1" />
        <line x1="36" y1="36" x2="36" y2="2" stroke="var(--teal)" strokeWidth="1.5" />
      </svg>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <p className="mono text-[12px] text-[var(--muted)]">{text}</p>
    </div>
  )
}

function RadarMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.8">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
      <line x1="12" y1="2" x2="12" y2="6" />
    </svg>
  )
}
