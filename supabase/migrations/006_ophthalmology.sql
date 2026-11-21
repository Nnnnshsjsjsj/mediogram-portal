-- Mediogram Portal — schema v6: третье направление, офтальмология.
--
-- Схема не меняется: trials.field и profiles.fields — свободный текст, новое
-- направление заводится во фронте (src/lib/types.ts → FIELDS) и в радаре.
-- Заявка: 10-я городская клиническая больница, Минск (О. Чадина), 11.11.2026.

comment on column public.trials.field is
  'Терапевтическое направление: cardiology | oncology | ophthalmology. Проставляет радар; по нему строятся вкладки триажа.';
