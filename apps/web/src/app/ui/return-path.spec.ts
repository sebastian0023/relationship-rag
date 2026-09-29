import { describe, expect, it } from 'vitest';
import { returnLabel, safeReturnPath } from './return-path.js';

describe('safeReturnPath', () => {
  it('accepts in-app paths only', () => {
    expect(safeReturnPath('/app/chat/abc')).toBe('/app/chat/abc');
    expect(safeReturnPath('/login')).toBeNull();
    expect(safeReturnPath('https://example.test/app/')).toBeNull();
    expect(safeReturnPath('/app//evil')).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });
});

describe('returnLabel', () => {
  it('names the section to go back to', () => {
    expect(returnLabel('/app/chat/abc')).toBe('Conversar');
    expect(returnLabel('/app/inbox/abc')).toBe('Buzón');
    expect(returnLabel('/app/cards/abc/view')).toBe('Tarjetas');
    expect(returnLabel(null)).toBe('Recuerdos');
  });
});
