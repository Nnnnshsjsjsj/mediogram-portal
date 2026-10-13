import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { getMyGroups, getMyProfile, logEvent } from './lib/api'
import type { Field, Profile } from './lib/types'
import { FIELDS, userFields } from './lib/types'
import TriageScreen from './screens/TriageScreen'
import DecisionsScreen from './screens/DecisionsScreen'
import GroupScreen from './screens/GroupScreen'
import ExpansionScreen from './screens/ExpansionScreen'
import SettingsScreen from './screens/SettingsScreen'
import AdminScreen from './admin/AdminScreen'

type Tab = `triage:${Field}` | 'decisions' | 'group' | 'expansion' | 'settings' | 'admin'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [tab, setTab] = useState<Tab>('triage:cardiology')
  const [inGroup, setInGroup] = useState(false)

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
    if (!session) return
    getMyProfile().then(setProfile).catch(console.error)
    // Вкладка «Группа» появляется, только если врача уже добавили в группу.
    getMyGroups().then((gs) => setInGroup(gs.length > 0)).catch(console.error)
  }, [session])

  if (!authReady) return <FullScreen><Spinner text="Проверка сессии…" /></FullScreen>
  if (!session) return <LoginScreen />
  if (!profile) return <FullScreen><Spinner text="Загрузка профиля…" /></FullScreen>

  const isAdmin = profile.role === 'admin'
  // Одно направление — привычная вкладка «Триаж»; несколько — по вкладке на каждое.
  const myFields = userFields(profile)
  const triageTabs: { id: Tab; label: string }[] = myFields.length === 1
    ? [{ id: `triage:${myFields[0]}`, label: 'Триаж' }]
    : myFields.map((f) => ({ id: `triage:${f}` as Tab, label: FIELDS[f].label }))
  const activeTab: Tab = tab.startsWith('triage:') && !myFields.includes(tab.slice(7) as Field)
    ? `triage:${myFields[0]}` : tab
  const tabs: { id: Tab; label: string }[] = [
    ...triageTabs,
    { id: 'decisions', label: 'Мои решения' },
    ...(inGroup ? [{ id: 'group' as Tab, label: 'Группа' }] : []),
    { id: 'expansion', label: 'Новое направление' },
    { id: 'settings', label: 'Настройки' },
    ...(isAdmin ? [{ id: 'admin' as Tab, label: 'Админ' }] : []),
  ]

  // Админке нужна ширина под таблицу, остальным экранам — удобная строка чтения.
  const wide = activeTab === 'admin'
  const displayName = profile.full_name || profile.email.split('@')[0]

  return (
    <div className="min-h-[100dvh] bg-[var(--bg)]">
      <header className="sticky top-0 z-40" style={{ background: 'var(--nav)', borderBottom: '1px solid var(--nav-line)' }}>
        <div className={`mx-auto ${wide ? 'max-w-7xl' : 'max-w-5xl'} px-4 h-14 flex items-center gap-4`}>
          <div className="flex items-center gap-2.5 shrink-0">
            <RadarMark size={26} animated />
            <div className="leading-tight hidden sm:block">
              <div className="text-[14px] font-semibold" style={{ color: 'var(--nav-text)' }}>Mediogram</div>
              <div className="mono text-[10px] tracking-wide" style={{ color: 'var(--nav-muted)' }}>PORTAL</div>
            </div>
          </div>

          <nav className="flex gap-0.5 ml-2 overflow-x-auto min-w-0 flex-1" aria-label="Разделы">
            {tabs.map((t) => {
              const on = activeTab === t.id
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  aria-current={on ? 'page' : undefined}
                  className="relative px-3 h-9 rounded-[10px] text-[13px] font-medium transition-colors whitespace-nowrap shrink-0"
                  style={on
                    ? { color: '#FFFFFF', background: 'var(--nav-2)' }
                    : { color: 'var(--nav-muted)' }}>
                  {t.label}
                  {on && <span className="absolute left-3 right-3 -bottom-[11px] h-[2px] rounded-full" style={{ background: 'var(--teal-bright)' }} />}
                </button>
              )
            })}
          </nav>

          <div className="hidden md:flex items-center gap-2 shrink-0 pl-3" style={{ borderLeft: '1px solid var(--nav-line)' }}>
            <span className="w-7 h-7 rounded-full grid place-items-center text-[12px] font-semibold"
              style={{ background: 'var(--nav-2)', color: 'var(--teal-bright)', border: '1px solid var(--nav-line)' }}>
              {displayName.slice(0, 1).toUpperCase()}
            </span>
            <div className="leading-tight max-w-[160px]">
              <div className="text-[12px] font-medium truncate" style={{ color: 'var(--nav-text)' }}>{displayName}</div>
              <div className="text-[10.5px]" style={{ color: 'var(--nav-muted)' }}>{isAdmin ? 'Администратор' : 'Врач'}</div>
            </div>
          </div>
        </div>
      </header>

      <main className={`mx-auto ${wide ? 'max-w-7xl' : 'max-w-4xl'} px-4 py-7 pb-24`}>
        {activeTab.startsWith('triage:') && (
          <TriageScreen key={activeTab} profile={profile} field={activeTab.slice(7) as Field}
            showFieldTitle={myFields.length > 1} />
        )}
        {activeTab === 'decisions' && <DecisionsScreen />}
        {activeTab === 'group' && inGroup && <GroupScreen profile={profile} />}
        {activeTab === 'expansion' && <ExpansionScreen profile={profile} />}
        {activeTab === 'settings' && <SettingsScreen profile={profile} onSaved={setProfile} />}
        {activeTab === 'admin' && isAdmin && <AdminScreen />}
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
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.origin + import.meta.env.BASE_URL,
          shouldCreateUser: false, // регистрация закрыта: аккаунты создаёт админ
        },
      })
      if (!error) { setSent(true); return }

      // supabase-js кладёт в message JSON.stringify(тела ответа), если сервер
      // не прислал msg/message/error_description — тогда на экране видно "{}".
      // Поэтому всегда показываем status + code, иначе диагностировать нечем.
      const code = (error as { code?: string }).code
      const detail = [error.status, code].filter(Boolean).join(' ')
      console.error('[auth] signInWithOtp failed', {
        name: error.name, status: error.status, code, message: error.message,
      })

      if (/signups? not allowed|otp_disabled/i.test(`${error.message} ${code ?? ''}`)) {
        setErr('Этот email не зарегистрирован. Обратитесь к администратору Mediogram.')
      } else if (/over_email_send_rate_limit|rate limit/i.test(`${error.message} ${code ?? ''}`) || error.status === 429) {
        setErr('Слишком много запросов. Подождите минуту и попробуйте снова.')
      } else {
        const msg = !error.message || error.message === '{}' ? 'Сервис авторизации вернул пустую ошибку' : error.message
        setErr(detail ? `${msg} (${detail})` : msg)
      }
    } catch (e) {
      console.error('[auth] signInWithOtp threw', e)
      setErr(`Не удалось связаться с сервисом авторизации: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[100dvh] relative overflow-hidden flex items-center justify-center px-4"
      style={{ background: 'var(--nav)' }}>
      {/* кольца радара на фоне */}
      <svg aria-hidden="true" className="absolute pointer-events-none" width="1100" height="1100" viewBox="0 0 1100 1100"
        style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)', opacity: 0.55 }}>
        {[120, 240, 360, 480].map((r) => (
          <circle key={r} cx="550" cy="550" r={r} fill="none" stroke="var(--nav-line)" strokeWidth="1" />
        ))}
        <g className="radar-sweep">
          <defs>
            <linearGradient id="sweepG" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#00B9BF" stopOpacity="0" />
              <stop offset="1" stopColor="#00B9BF" stopOpacity="0.22" />
            </linearGradient>
          </defs>
          <path d="M550 550 L550 70 A480 480 0 0 1 889 211 Z" fill="url(#sweepG)" />
        </g>
      </svg>

      <div className="relative w-full max-w-[400px] rise">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <RadarMark size={34} animated />
          <div className="leading-tight">
            <div className="text-[18px] font-semibold" style={{ color: 'var(--nav-text)' }}>Mediogram Portal</div>
            <div className="mono text-[11px] tracking-wide" style={{ color: 'var(--nav-muted)' }}>триаж клинических исследований</div>
          </div>
        </div>

        <div className="rounded-[22px] p-7 flex flex-col gap-5" style={{ background: 'var(--card)', boxShadow: 'var(--shadow-pop)' }}>
          {sent ? (
            <div className="flex flex-col gap-3">
              <span className="w-10 h-10 rounded-full grid place-items-center" style={{ background: 'var(--teal-soft)', color: 'var(--teal)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /></svg>
              </span>
              <p className="text-[15px] font-semibold">Проверьте почту</p>
              <p className="text-[13.5px] text-[var(--muted)]">
                Ссылка для входа отправлена на <span className="mono text-[var(--teal)]">{email}</span>.
                Она одноразовая и действует 15 минут.
              </p>
            </div>
          ) : (
            <>
              <div>
                <h1 className="text-[19px] font-semibold">Вход в кабинет</h1>
                <p className="text-[13px] text-[var(--muted)] mt-1">Без паролей — пришлём персональную одноразовую ссылку.</p>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="eyebrow">Рабочий email</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && sendLink()}
                  type="email" placeholder="doctor@clinic.by" autoFocus
                  className="input h-11 text-[14px]" />
              </label>
              <button onClick={sendLink} disabled={busy || !email.includes('@')} className="btn btn-primary h-11 text-[14px]">
                {busy ? 'Отправка…' : 'Получить ссылку для входа'}
              </button>
              {err && (
                <p className="text-[12.5px] rounded-xl px-3 py-2.5" style={{ color: 'var(--red)', background: 'var(--red-soft)' }}>{err}</p>
              )}
            </>
          )}
        </div>
        <p className="text-center text-[11.5px] mt-5" style={{ color: 'var(--nav-muted)' }}>
          Доступ выдаёт администратор Mediogram
        </p>
      </div>
    </div>
  )
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] flex items-center justify-center px-4 bg-[var(--bg)]">{children}</div>
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <svg width="56" height="56" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r="34" fill="none" stroke="var(--line)" strokeWidth="1" />
        <circle cx="36" cy="36" r="22" fill="none" stroke="var(--line)" strokeWidth="1" />
        <circle cx="36" cy="36" r="10" fill="none" stroke="var(--line)" strokeWidth="1" />
        <line className="radar-sweep" x1="36" y1="36" x2="36" y2="2" stroke="var(--teal)" strokeWidth="1.5"
          style={{ animationDuration: '2.4s' }} />
      </svg>
      <p className="mono text-[12px] text-[var(--muted)]">{text}</p>
    </div>
  )
}

function RadarMark({ size = 24, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10.5" stroke="var(--teal-bright)" strokeWidth="1.4" opacity=".45" />
      <circle cx="12" cy="12" r="6.5" stroke="var(--teal-bright)" strokeWidth="1.4" opacity=".7" />
      <circle cx="12" cy="12" r="2.2" fill="var(--teal-bright)" />
      <line className={animated ? 'radar-sweep' : undefined} x1="12" y1="12" x2="12" y2="1.5"
        stroke="var(--teal-bright)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
