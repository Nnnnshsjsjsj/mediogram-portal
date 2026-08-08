import { supabase } from './supabase'
import type { Decision, DecisionStatus, Profile, Trial, WorkStage } from './types'

export async function getMyProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (error) throw error
  return data as Profile
}

export async function updateMyProfile(patch: Partial<Pick<Profile, 'full_name' | 'specialty' | 'categories' | 'cc_emails'>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('no session')
  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
  if (error) throw error
}

// Последний выпуск + его исследования. Если выпусков ещё нет — просто свежие trials.
export async function getLatestTrials(): Promise<{ weekStart: string | null; trials: Trial[] }> {
  const { data: digest } = await supabase
    .from('digests').select('id, week_start')
    .order('week_start', { ascending: false }).limit(1).maybeSingle()

  if (digest) {
    const { data, error } = await supabase
      .from('digest_trials')
      .select('rank, trials(*)')
      .eq('digest_id', digest.id)
      .order('rank')
    if (error) throw error
    const trials = (data ?? []).map((r) => r.trials as unknown as Trial)
    return { weekStart: digest.week_start, trials }
  }
  const { data, error } = await supabase
    .from('trials').select('*')
    .order('first_seen_at', { ascending: false }).limit(60)
  if (error) throw error
  return { weekStart: null, trials: (data ?? []) as Trial[] }
}

export async function getMyDecisions(): Promise<Decision[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase.from('decisions').select('*').eq('user_id', user.id)
  if (error) throw error
  return (data ?? []) as Decision[]
}

export async function decide(trialId: string, status: DecisionStatus) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('no session')
  const row = {
    user_id: user.id,
    trial_id: trialId,
    status,
    work_stage: status === 'accepted' ? ('interest' as WorkStage) : null,
    decided_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('decisions').upsert(row)
  if (error) throw error
}

export async function setStage(trialId: string, stage: WorkStage) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('no session')
  const { error } = await supabase.from('decisions')
    .update({ work_stage: stage })
    .eq('user_id', user.id).eq('trial_id', trialId).eq('status', 'accepted')
  if (error) throw error
}

export async function clearDecision(trialId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('no session')
  const { error } = await supabase.from('decisions')
    .delete().eq('user_id', user.id).eq('trial_id', trialId)
  if (error) throw error
}

export async function getMyWatches(): Promise<Set<string>> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Set()
  const { data } = await supabase.from('watches').select('trial_id').eq('user_id', user.id)
  return new Set((data ?? []).map((r) => r.trial_id as string))
}

export async function toggleWatch(trialId: string, on: boolean) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('no session')
  if (on) {
    const { error } = await supabase.from('watches').upsert({ user_id: user.id, trial_id: trialId })
    if (error) throw error
  } else {
    const { error } = await supabase.from('watches').delete().eq('user_id', user.id).eq('trial_id', trialId)
    if (error) throw error
  }
}

export async function logEvent(event: string, meta?: Record<string, unknown>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('activity_log').insert({ user_id: user.id, event, meta: meta ?? null })
}

// -------- админ --------
export async function adminGetDoctors(): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('*').order('full_name')
  if (error) throw error
  return (data ?? []) as Profile[]
}

export async function adminGetAllDecisions(): Promise<Decision[]> {
  const { data, error } = await supabase.from('decisions').select('*')
  if (error) throw error
  return (data ?? []) as Decision[]
}

export async function adminGetActivity(days = 30) {
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const { data, error } = await supabase
    .from('activity_log').select('*').gte('created_at', since)
    .order('created_at', { ascending: false }).limit(500)
  if (error) throw error
  return data ?? []
}

export async function adminUpdateDoctor(id: string, patch: Partial<Profile>) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', id)
  if (error) throw error
}

export async function adminSetStage(userId: string, trialId: string, stage: WorkStage) {
  const { error } = await supabase.from('decisions')
    .update({ work_stage: stage })
    .eq('user_id', userId).eq('trial_id', trialId).eq('status', 'accepted')
  if (error) throw error
}

// Приглашение нового врача — через Edge Function (service role живёт на сервере).
export async function adminInvite(email: string, fullName: string) {
  const { data, error } = await supabase.functions.invoke('admin-invite', {
    body: { email, full_name: fullName },
  })
  if (error) throw error
  return data
}
