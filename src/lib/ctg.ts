// Контакты исследования напрямую с ClinicalTrials.gov — для кнопки
// «Обновить контакты» в админ-панели.
//
// Обычно контакты уже лежат в trial_contacts: их раз в сутки складывает
// scripts/fetch_contacts.mjs. Этот модуль нужен на случай, когда врач принял
// исследование только что и ждать ночного прогона незачем.
//
// Публичный API ClinicalTrials.gov отдаёт CORS-заголовки, ключ не нужен.
// Маппинг обязан совпадать со scripts/fetch_contacts.mjs — обе стороны пишут
// в одну и ту же таблицу.

import type { ContactPerson, ContactSite, Official, TrialContactsData } from './types'

const FIELDS = [
  'protocolSection.contactsLocationsModule',
  'protocolSection.sponsorCollaboratorsModule',
  'protocolSection.statusModule',
  'protocolSection.designModule',
].join(',')

interface RawPerson { name?: string; role?: string; email?: string; phone?: string; phoneExt?: string }
interface RawLocation { facility?: string; city?: string; country?: string; status?: string; contacts?: RawPerson[] }

function person(c: RawPerson): ContactPerson {
  return {
    name: c?.name ?? '',
    role: c?.role ?? '',
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    ext: c?.phoneExt ?? '',
  }
}
const hasWay = (p: ContactPerson) => Boolean(p.email || p.phone)

export function mapStudy(json: Record<string, any>): TrialContactsData {
  const ps = json?.protocolSection ?? {}
  const cl = ps.contactsLocationsModule ?? {}
  const sc = ps.sponsorCollaboratorsModule ?? {}
  const st = ps.statusModule ?? {}

  const locations: RawLocation[] = Array.isArray(cl.locations) ? cl.locations : []
  const sites: ContactSite[] = locations
    .filter((l) => (l.contacts ?? []).some((c) => c?.email || c?.phone))
    .slice(0, 25)
    .map((l) => ({
      facility: l.facility ?? '',
      city: l.city ?? '',
      country: l.country ?? '',
      status: l.status ?? '',
      contacts: (l.contacts ?? []).map(person).filter(hasWay),
    }))

  const rp = sc.responsibleParty ?? {}
  const responsible = [rp.investigatorFullName, rp.investigatorTitle, rp.investigatorAffiliation]
    .filter(Boolean).join(', ') || (rp.type ? String(rp.type).split('_').join(' ') : '')

  return {
    lead_sponsor: sc.leadSponsor?.name ?? null,
    sponsor_class: sc.leadSponsor?.class ?? null,
    collaborators: (sc.collaborators ?? []).map((c: { name?: string }) => c?.name).filter(Boolean),
    responsible_party: responsible || null,
    central_contacts: (cl.centralContacts ?? []).map(person).filter(hasWay),
    officials: ((cl.overallOfficials ?? []) as RawPerson[]).map((o): Official => ({
      name: o?.name ?? '',
      affiliation: (o as { affiliation?: string })?.affiliation ?? '',
      role: o?.role ?? '',
    })).filter((o) => o.name),
    sites,
    sites_total: locations.length,
    enrollment: ps.designModule?.enrollmentInfo?.count ?? null,
    start_date: st.startDateStruct?.date ?? null,
    completion_date: st.primaryCompletionDateStruct?.date ?? st.completionDateStruct?.date ?? null,
    last_update_posted: st.lastUpdatePostDateStruct?.date ?? null,
  }
}

export async function fetchTrialContacts(nctId: string): Promise<TrialContactsData> {
  const res = await fetch(`https://clinicaltrials.gov/api/v2/studies/${nctId}?fields=${FIELDS}`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`ClinicalTrials.gov ответил ${res.status}`)
  return mapStudy(await res.json())
}
