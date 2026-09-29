/** Scheduled delivery is chosen in the viewer's own time zone and sent as an absolute instant. */
export type ScheduleResult =
  { readonly ok: true; readonly instant: string } | { readonly ok: false; readonly error: string };

const MINIMUM_LEAD_MS = 60_000;

const localMinute = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;

export const scheduleInstant = (date: string, time: string, now: Date): ScheduleResult => {
  if (date === '' || time === '')
    return { ok: false, error: 'Elige la fecha y la hora de entrega.' };
  const requested = `${date}T${time.slice(0, 5)}`;
  const parsed = new Date(requested);
  if (!Number.isFinite(parsed.getTime()))
    return { ok: false, error: 'La fecha o la hora no son válidas.' };
  if (localMinute(parsed) !== requested)
    return {
      ok: false,
      error: 'Esa hora no existe ese día por el cambio de horario. Elige una hora más tarde.',
    };
  if (
    localMinute(new Date(parsed.getTime() - 3_600_000)) === requested ||
    localMinute(new Date(parsed.getTime() + 3_600_000)) === requested
  )
    return {
      ok: false,
      error:
        'Esa hora ocurre dos veces ese día por el cambio de horario. Elige otra, por ejemplo una hora más tarde.',
    };
  if (parsed.getTime() <= now.getTime() + MINIMUM_LEAD_MS)
    return { ok: false, error: 'Esa hora ya pasó. Elige un momento futuro.' };
  return { ok: true, instant: parsed.toISOString() };
};

/** For example «hora de verano de Europa central (Europe/Madrid)». */
export const timeZoneLabel = (now: Date = new Date()): string => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const name = new Intl.DateTimeFormat('es', { timeZoneName: 'long' })
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName')?.value;
  return name === undefined ? zone : `${name} (${zone})`;
};
