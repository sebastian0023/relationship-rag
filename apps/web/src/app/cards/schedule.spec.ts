import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scheduleInstant } from './schedule.js';

describe('scheduleInstant in Europe/Madrid', () => {
  const originalZone = process.env['TZ'];
  const now = new Date('2026-09-29T08:00:00.000Z');

  beforeAll(() => {
    process.env['TZ'] = 'Europe/Madrid';
  });

  afterAll(() => {
    if (originalZone === undefined) delete process.env['TZ'];
    else process.env['TZ'] = originalZone;
  });

  it('converts a future local minute to an absolute instant', () => {
    expect(scheduleInstant('2026-10-14', '09:00', now)).toEqual({
      ok: true,
      instant: '2026-10-14T07:00:00.000Z',
    });
  });

  it('requires both fields', () => {
    expect(scheduleInstant('', '09:00', now)).toEqual({
      ok: false,
      error: 'Elige la fecha y la hora de entrega.',
    });
  });

  it('rejects past and imminent times', () => {
    expect(scheduleInstant('2026-09-29', '10:00', now)).toMatchObject({ ok: false });
    expect(scheduleInstant('2026-09-29', '09:00', now)).toMatchObject({
      error: 'Esa hora ya pasó. Elige un momento futuro.',
    });
  });

  it('rejects a time skipped when clocks go forward', () => {
    expect(scheduleInstant('2027-03-28', '02:30', now)).toMatchObject({
      ok: false,
      error: expect.stringContaining('no existe'),
    });
  });

  it('rejects a time repeated when clocks go back', () => {
    expect(scheduleInstant('2026-10-25', '02:30', now)).toMatchObject({
      ok: false,
      error: expect.stringContaining('ocurre dos veces'),
    });
  });
});
