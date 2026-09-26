import { supabase } from './supabase'
import type { Decision, DecisionStatus, Group, GroupMember, Peer, Profile, Trial, TrialContacts, TrialContactsData, WorkStage } from './types'
import { peerName } from './types'
import type { ExpansionData, ExpansionRequest, ExpansionStatus } from './expansion'
import { normalizeExpansionData } from './expansion'

export async function getMyProfile(): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (error) throw error
  return data as Profile
}

export async function updateMyProfile(patch: Partial<Pick<Profile, 'full_name' | 'specialty' | 'categories'>>) {
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

// Исследования по списку id — принятые решения бывают из прошлых выпусков,
// которых уже нет в getLatestTrials().
export async function getTrialsByIds(ids: string[]): Promise<Trial[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.from('trials').select('*').in('id', ids)
  if (error) throw error
  return (data ?? []) as Trial[]
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
export async function adminInvite(email: string, fullName: string, groupId?: string | null) {
  const { data, error } = await supabase.functions.invoke('admin-invite', {
    body: { email, full_name: fullName, group_id: groupId || null },
  })
  if (error) throw error
  return data
}

// -------- заметки врача --------
// Заметку видит сам врач, его группа и админ. Пустая строка стирает заметку.
export async function setDecisionNote(trialId: string, note: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('no session')
  const { error } = await supabase.from('decisions')
    .update({ note: note.trim() || null })
    .eq('user_id', user.id).eq('trial_id', trialId)
  if (error) throw error
}

// -------- группы --------
// Группы, в которых состоит текущий пользователь. RLS сам ограничивает выдачу.
export async function getMyGroups(): Promise<Group[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('group_members').select('groups(id, name)').eq('user_id', user.id)
  if (error) throw error
  return (data ?? [])
    .map((r) => r.groups as unknown as Group)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

// Состав группы вместе с профилями коллег.
export async function getGroupPeers(groupId: string): Promise<Peer[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('user_id, profiles(id, full_name, email, specialty, is_active)')
    .eq('group_id', groupId)
  if (error) throw error
  return (data ?? [])
    .map((r) => r.profiles as unknown as (Peer & { is_active: boolean }))
    .filter((p) => p && p.is_active)
    .sort((a, b) => peerName(a).localeCompare(peerName(b), 'ru'))
}

// Решения коллег по группе. Политика decisions_group_read отдаёт только
// тех, с кем есть общая группа, поэтому фильтруем по составу на клиенте.
export async function getGroupDecisions(peerIds: string[]): Promise<Decision[]> {
  if (!peerIds.length) return []
  const { data, error } = await supabase
    .from('decisions').select('*').in('user_id', peerIds)
  if (error) throw error
  return (data ?? []) as Decision[]
}

// -------- админ: группы --------
export async function adminGetGroups(): Promise<Group[]> {
  const { data, error } = await supabase.from('groups').select('*').order('name')
  if (error) throw error
  return (data ?? []) as Group[]
}

export async function adminGetGroupMembers(): Promise<GroupMember[]> {
  const { data, error } = await supabase.from('group_members').select('group_id, user_id')
  if (error) throw error
  return (data ?? []) as GroupMember[]
}

export async function adminCreateGroup(name: string): Promise<Group> {
  const { data, error } = await supabase
    .from('groups').insert({ name: name.trim() }).select().single()
  if (error) throw error
  return data as Group
}

export async function adminRenameGroup(id: string, name: string) {
  const { error } = await supabase.from('groups').update({ name: name.trim() }).eq('id', id)
  if (error) throw error
}

// Удаление группы не трогает ни врачей, ни их решения — только состав (cascade).
export async function adminDeleteGroup(id: string) {
  const { error } = await supabase.from('groups').delete().eq('id', id)
  if (error) throw error
}

export async function adminAddMember(groupId: string, userId: string) {
  const { error } = await supabase.from('group_members')
    .upsert({ group_id: groupId, user_id: userId })
  if (error) throw error
}

export async function adminRemoveMember(groupId: string, userId: string) {
  const { error } = await supabase.from('group_members')
    .delete().eq('group_id', groupId).eq('user_id', userId)
  if (error) throw error
}

// -------- админ: контакты спонсоров --------
// Таблица trial_contacts закрыта политикой is_admin(): врач её не видит,
// поэтому эти функции живут только в админ-панели.

export async function adminGetTrialContacts(trialIds: string[]): Promise<Map<string, TrialContacts>> {
  const map = new Map<string, TrialContacts>()
  if (!trialIds.length) return map
  const { data, error } = await supabase
    .from('trial_contacts').select('*').in('trial_id', trialIds)
  if (error) throw error
  for (const row of (data ?? []) as TrialContacts[]) map.set(row.trial_id, row)
  return map
}

// Кнопка «Обновить контакты»: тянем свежее из ClinicalTrials.gov (см. lib/ctg.ts)
// и кладём в кэш, чтобы следующая загрузка панели была мгновенной.
export async function adminSaveTrialContacts(trialId: string, data: TrialContactsData): Promise<TrialContacts> {
  const row = { trial_id: trialId, ...data, fetched_at: new Date().toISOString() }
  const { error } = await supabase.from('trial_contacts').upsert(row, { onConflict: 'trial_id' })
  if (error) throw error
  return row as TrialContacts
}

// -------- заявки на новые направления --------
const EXPANSION_COLS = 'id, created_by, status, field_ru, field_en, data, admin_note, submitted_at, reviewed_at, created_at, updated_at'

function hydrateExpansion(row: Record<string, unknown>): ExpansionRequest {
  return { ...(row as unknown as ExpansionRequest), data: normalizeExpansionData(row.data) }
}

export async function getMyExpansionRequests(): Promise<ExpansionRequest[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('expansion_requests').select(EXPANSION_COLS)
    .eq('created_by', user.id).order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(hydrateExpansion)
}

export async function createExpansionRequest(fieldRu: string, fieldEn: string, payload: ExpansionData): Promise<ExpansionRequest> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('no session')
  const { data, error } = await supabase
    .from('expansion_requests')
    .insert({ created_by: user.id, field_ru: fieldRu.trim(), field_en: fieldEn.trim(), data: payload, status: 'draft' })
    .select(EXPANSION_COLS).single()
  if (error) throw error
  return hydrateExpansion(data)
}

export async function updateExpansionRequest(
  id: string,
  patch: { field_ru?: string; field_en?: string; data?: ExpansionData; status?: ExpansionStatus },
): Promise<ExpansionRequest> {
  const { data, error } = await supabase
    .from('expansion_requests').update(patch).eq('id', id)
    .select(EXPANSION_COLS).single()
  if (error) throw error
  return hydrateExpansion(data)
}

export async function deleteExpansionRequest(id: string) {
  const { error } = await supabase.from('expansion_requests').delete().eq('id', id)
  if (error) throw error
}

// -------- админ: заявки --------
export async function adminGetExpansionRequests(): Promise<ExpansionRequest[]> {
  const { data, error } = await supabase
    .from('expansion_requests')
    .select(`${EXPANSION_COLS}, admin_data, author:profiles!expansion_requests_created_by_fkey(id, full_name, email, specialty)`)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => hydrateExpansion(row as unknown as Record<string, unknown>))
}

export async function adminUpdateExpansionRequest(
  id: string,
  patch: { status?: ExpansionStatus; admin_note?: string | null; admin_data?: Record<string, unknown>; reviewed_at?: string },
) {
  const { error } = await supabase.from('expansion_requests').update(patch).eq('id', id)
  if (error) throw error
}
