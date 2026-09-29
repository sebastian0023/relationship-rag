const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

const SHORT_MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
] as const;

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface DateTimeParts extends DateParts {
  readonly hour: string;
  readonly minute: string;
}

/** Reads a calendar date (`YYYY-MM-DD`) without shifting it through a time zone. */
export const calendarParts = (isoDate: string): DateParts => {
  const [year = 0, month = 1, day = 1] = isoDate.slice(0, 10).split('-').map(Number);
  return { year, month, day };
};

/** Reads an instant in the viewer's time zone (or the given one). */
export const instantParts = (isoDateTime: string, timeZone?: string): DateTimeParts => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).formatToParts(new Date(isoDateTime));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '0';
  return {
    year: Number(part('year')),
    month: Number(part('month')),
    day: Number(part('day')),
    hour: part('hour'),
    minute: part('minute'),
  };
};

const longLabel = ({ year, month, day }: DateParts) =>
  `${day} de ${MONTHS[month - 1] ?? ''} de ${year}`;
const shortLabel = ({ year, month, day }: DateParts) =>
  `${day} ${SHORT_MONTHS[month - 1] ?? ''} ${year}`;

/** `2026-09-14` → `14 de septiembre de 2026`. */
export const formatLongDate = (isoDate: string): string => longLabel(calendarParts(isoDate));

/** `2026-09-14` → `14 sep 2026`. */
export const formatShortDate = (isoDate: string): string => shortLabel(calendarParts(isoDate));

/** Instant → `14 de septiembre de 2026` in the viewer's time zone. */
export const formatLongInstant = (isoDateTime: string, timeZone?: string): string =>
  longLabel(instantParts(isoDateTime, timeZone));

/** Instant → `14 sep 2026` in the viewer's time zone. */
export const formatShortInstant = (isoDateTime: string, timeZone?: string): string =>
  shortLabel(instantParts(isoDateTime, timeZone));

/** Instant → `14 de octubre de 2026, 09:00` in the viewer's time zone. */
export const formatInstantWithTime = (isoDateTime: string, timeZone?: string): string => {
  const parts = instantParts(isoDateTime, timeZone);
  return `${longLabel(parts)}, ${parts.hour}:${parts.minute}`;
};

/** `hace un momento`, `hace 5 minutos`, `hace 2 horas`, or `el 14 de septiembre de 2026`. */
export const relativeTime = (isoDateTime: string, now: Date, timeZone?: string): string => {
  const minutes = Math.floor((now.getTime() - new Date(isoDateTime).getTime()) / 60_000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return minutes === 1 ? 'hace 1 minuto' : `hace ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'hace 1 hora' : `hace ${hours} horas`;
  return `el ${formatLongInstant(isoDateTime, timeZone)}`;
};

/** `2026-09-14` → `Septiembre de 2026`. */
export const monthGroupLabel = (isoDate: string): string => {
  const { year, month } = calendarParts(isoDate);
  const name = MONTHS[month - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${year}`;
};

const groupThousands = (value: number): string =>
  value >= 10_000 ? String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : String(value);

/** Character counter, shown only from 80 % of the limit. */
export const counterLabel = (value: string, max: number): string =>
  value.length >= max * 0.8 ? `${groupThousands(value.length)} / ${groupThousands(max)}` : '';

/** Shortens text at a word boundary. */
export const excerpt = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const whole = /\s/.test(text.charAt(max)) ? cut : cut.replace(/\s+\S*$/, '');
  return `${whole.trimEnd()}…`;
};

/** `1 recuerdo`, `3 recuerdos`. */
export const countLabel = (count: number, singular: string, plural: string): string =>
  `${count} ${count === 1 ? singular : plural}`;

/** First visible letter of a display name, for avatars. */
export const initialOf = (name: string | undefined): string =>
  (name?.trim().charAt(0) ?? '').toLocaleUpperCase('es') || '·';
