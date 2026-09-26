import type { ExpansionRequest } from '../lib/expansion'
import {
  AGE_GROUPS, DIGEST_FREQ, ETHICS, INFRASTRUCTURE, PHASES, PRIORITY, RESPONSE_TIME, STUDY_TYPES, TRIAL_EXPERIENCE,
} from '../lib/expansion'

// Компактное чтение заявки. Используется врачом (после отправки) и администратором.
export default function ExpansionSummary({ r }: { r: ExpansionRequest }) {
  const d = r.data
  const labels = (keys: string[], dict: Record<string, string>) => keys.map((k) => dict[k] ?? k)

  return (
    <div className="flex flex-col gap-4 text-[13px]">
      <Block title="1 · Направление и центр">
        <Row k="Направление" v={`${r.field_ru}${r.field_en ? ` / ${r.field_en}` : ''}`} />
        {d.description && <Row k="Описание" v={d.description} pre />}
        <Row k="Учреждение" v={[d.institution, d.department, d.city].filter(Boolean).join(' · ')} />
        <Row k="Ответственный" v={[d.lead_name, d.lead_position].filter(Boolean).join(', ')} />
        <Row k="Контакт" v={d.contact} mono />
      </Block>

      <Block title="2 · Подобласти">
        {d.subareas.filter((s) => s.name_ru.trim()).map((s, i) => (
          <div key={i} className="rounded-xl border border-[var(--line)] px-3 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{s.name_ru}</span>
              {s.name_en && <span className="text-[var(--muted)]">{s.name_en}</span>}
              <span className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--line)] text-[var(--muted)] ml-auto">
                {PRIORITY[s.priority]} приоритет
              </span>
            </div>
            <Chips items={s.terms} mono />
            {s.note && <p className="text-[12px] text-[var(--muted)]">{s.note}</p>}
          </div>
        ))}
        {!d.subareas.some((s) => s.name_ru.trim()) && <Empty />}
      </Block>

      <Block title="3 · Что искать">
        <Row k="Заболевания" v={<Chips items={d.conditions} mono />} />
        <Row k="Вмешательства" v={<Chips items={d.interventions} mono />} />
        <Row k="Типы исследований" v={labels(d.study_types, STUDY_TYPES).join(', ')} />
        <Row k="Фазы" v={labels(d.phases, PHASES).join(', ')} />
        <Row k="Возраст" v={labels(d.age_groups, AGE_GROUPS).join(', ')} />
        <Row k="Исключить" v={<Chips items={d.exclude} mono tone="red" />} />
      </Block>

      <Block title="4 · Ключевые слова для радара">
        <Row k="Англ." v={<Chips items={d.keywords_en} mono />} />
        <Row k="Рус." v={<Chips items={d.keywords_ru} />} />
        <Row k="Спонсоры" v={<Chips items={d.sponsors} />} />
        <Row k="Примеры NCT" v={<Chips items={d.example_ncts} mono link />} />
      </Block>

      <Block title="5 · Возможности центра">
        <Row k="Поток пациентов" v={d.patients_per_month ? `${d.patients_per_month} в месяц` : ''} />
        <Row k="Опыт КИ" v={TRIAL_EXPERIENCE[d.trial_experience] ?? ''} />
        <Row k="GCP-врачей" v={d.gcp_doctors} />
        <Row k="Инфраструктура" v={[...labels(d.infrastructure, INFRASTRUCTURE), d.infrastructure_other].filter(Boolean).join(', ')} />
        <Row k="Этический комитет" v={ETHICS[d.ethics_committee] ?? ''} />
      </Block>

      <Block title="6 · Команда">
        <Row k="Коллеги" v={<Chips items={d.colleagues} mono />} />
        <Row k="Дайджест" v={DIGEST_FREQ[d.digest_frequency] ?? ''} />
        <Row k="Ответ спонсору" v={RESPONSE_TIME[d.response_time] ?? ''} />
        {d.notes && <Row k="Комментарий" v={d.notes} pre />}
      </Block>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[11px] uppercase tracking-wide font-semibold text-[var(--muted)]">{title}</h4>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  )
}

function Row({ k, v, mono, pre }: { k: string; v: React.ReactNode; mono?: boolean; pre?: boolean }) {
  const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0)
  return (
    <div className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-0.5 items-start">
      <span className="text-[var(--muted)]">{k}</span>
      <span className={`${mono ? 'mono text-[12px]' : ''} ${pre ? 'whitespace-pre-line' : ''}`}>
        {empty ? <span className="text-[var(--muted)]">—</span> : v}
      </span>
    </div>
  )
}

function Chips({ items, mono, tone, link }: { items: string[]; mono?: boolean; tone?: 'red'; link?: boolean }) {
  if (!items.length) return <span className="text-[var(--muted)]">—</span>
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((t, i) => {
        const cls = `text-[11px] px-2 py-0.5 rounded-full border ${mono ? 'mono' : ''}`
        const style = tone === 'red'
          ? { borderColor: 'var(--red)', color: 'var(--red)', background: 'var(--red-soft)' }
          : { borderColor: 'var(--line)', background: 'var(--panel)' }
        return link && /^NCT\d{8}$/i.test(t)
          ? <a key={i} href={`https://clinicaltrials.gov/study/${t.toUpperCase()}`} target="_blank" rel="noreferrer"
              className={`${cls} hover:underline`} style={{ ...style, color: 'var(--teal)' }}>{t.toUpperCase()}</a>
          : <span key={i} className={cls} style={style}>{t}</span>
      })}
    </span>
  )
}

function Empty() {
  return <span className="text-[var(--muted)]">—</span>
}
