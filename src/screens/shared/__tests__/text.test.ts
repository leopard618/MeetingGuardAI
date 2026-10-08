import { capitalizeFirst } from '../text';

describe('capitalizeFirst', () => {
  it('capitalizes Spanish dates and leaves the rest alone', () => {
    expect(capitalizeFirst('lunes, 5 de octubre de 2026')).toBe('Lunes, 5 de octubre de 2026');
    expect(capitalizeFirst('Monday, October 5, 2026')).toBe('Monday, October 5, 2026');
    expect(capitalizeFirst('ñu')).toBe('Ñu');
    expect(capitalizeFirst('')).toBe('');
  });
});
