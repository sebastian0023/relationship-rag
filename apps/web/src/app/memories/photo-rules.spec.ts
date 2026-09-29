import { describe, expect, it } from 'vitest';
import { MAX_PHOTO_BYTES, photoProblem } from './photo-rules.js';

describe('photoProblem', () => {
  it('accepts JPEG, PNG, and WebP up to 10 MiB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp'])
      expect(photoProblem({ name: 'foto', type, size: MAX_PHOTO_BYTES }, 0)).toBeNull();
  });

  it('explains how to replace a HEIC photo', () => {
    expect(photoProblem({ name: 'IMG_2044.HEIC', type: '', size: 1 }, 0)).toContain(
      'Más compatible',
    );
    expect(photoProblem({ name: 'a.jpg', type: 'image/heif', size: 1 }, 0)).toContain('HEIC');
  });

  it('rejects other types, large files, and a full memory', () => {
    expect(photoProblem({ name: 'nota.pdf', type: 'application/pdf', size: 1 }, 0)).toBe(
      '«nota.pdf» no es compatible. Elige un archivo JPEG, PNG o WebP.',
    );
    expect(
      photoProblem({ name: 'panoramica.jpg', type: 'image/jpeg', size: 14.2 * 1024 * 1024 }, 0),
    ).toBe('«panoramica.jpg» pesa 14,2 MiB y el máximo es 10 MiB. Elige una versión más liviana.');
    expect(photoProblem({ name: 'a.jpg', type: 'image/jpeg', size: 1 }, 10)).toBe(
      'Este recuerdo ya tiene 10 fotografías, el máximo.',
    );
  });
});
