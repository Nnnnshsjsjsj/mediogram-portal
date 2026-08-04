import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !anon) {
  // Осознанно падаем громко: без ключей портал бесполезен.
  throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY не заданы (.env)')
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
