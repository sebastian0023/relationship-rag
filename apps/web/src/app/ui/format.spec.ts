import { describe, expect, it } from 'vitest';
import {
  calendarParts,
  counterLabel,
  countLabel,
  excerpt,
  formatInstantWithTime,
  formatLongDate,
  formatLongInstant,
  formatShortDate,
  formatShortInstant,
  initialOf,
  monthGroupLabel,
} from './format.js';

describe('calendar dates', () => {
  it('formats a memory date without shifting it through a time zone', () => {
    expect(calendarParts('2026-01-01')).toEqual({ year: 2026, month: 1, day: 1 });
    expect(formatLongDate('2026-09-14')).toBe('14 de septiembre de 2026');
    expect(formatShortDate('2026-03-01')).toBe('1 mar 2026');
  });

  it('labels a month group with a capitalised month', () => {
    expect(monthGroupLabel('2026-06-20')).toBe('Junio de 2026');
  });
});

describe('instants', () => {
  it('formats an instant in the requested time zone', () => {
    expect(formatLongInstant('2026-09-20T23:30:00.000Z', 'Europe/Madrid')).toBe(
      '21 de septiembre de 2026',
    );
    expect(formatShortInstant('2026-09-20T23:30:00.000Z', 'UTC')).toBe('20 sep 2026');
    expect(formatInstantWithTime('2026-10-14T07:00:00.000Z', 'Europe/Madrid')).toBe(
      '14 de octubre de 2026, 09:00',
    );
  });
});

describe('counterLabel', () => {
  it('stays hidden below 80 % of the limit', () => {
    expect(counterLabel('a'.repeat(95), 120)).toBe('');
  });

  it('shows the count from 80 % and groups large numbers', () => {
    expect(counterLabel('a'.repeat(104), 120)).toBe('104 / 120');
    expect(counterLabel('a'.repeat(10_000), 10_000)).toBe('10 000 / 10 000');
  });
});

describe('text helpers', () => {
  it('shortens at a word boundary', () => {
    expect(excerpt('Nos refugiamos de la lluvia', 14)).toBe('Nos refugiamos…');
    expect(excerpt('Corto', 14)).toBe('Corto');
  });

  it('pluralises counts', () => {
    expect(countLabel(1, 'recuerdo', 'recuerdos')).toBe('1 recuerdo');
    expect(countLabel(3, 'recuerdo', 'recuerdos')).toBe('3 recuerdos');
  });

  it('derives an avatar initial', () => {
    expect(initialOf('lucía')).toBe('L');
    expect(initialOf('  ')).toBe('·');
    expect(initialOf(undefined)).toBe('·');
  });
});
