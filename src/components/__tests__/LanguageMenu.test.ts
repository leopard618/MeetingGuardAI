import { placeMenu } from '../LanguageMenu';

const SCREEN = { width: 400, height: 800 };
const INSETS = { top: 24, bottom: 16 };
const FIVE = { fullWidth: false, rows: 5 };

describe('placeMenu', () => {
  it('opens under a pill in the right half, right-aligned to it', () => {
    const pill = { x: 310, y: 30, width: 76, height: 32 };
    const placed = placeMenu(pill, SCREEN, INSETS, FIVE);
    expect(placed.top).toBeGreaterThan(pill.y + pill.height);
    expect(placed.left + placed.width).toBe(pill.x + pill.width);
  });

  it('opens under a pill in the left half, left-aligned, and never past the screen edge', () => {
    const placed = placeMenu({ x: 4, y: 30, width: 76, height: 32 }, SCREEN, INSETS, FIVE);
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.left + placed.width).toBeLessThanOrEqual(SCREEN.width - 8);
  });

  it('takes the width of a full-width field and opens upwards when the bottom would be cut', () => {
    const field = { x: 16, y: 700, width: 280, height: 44 };
    const placed = placeMenu(field, SCREEN, INSETS, { fullWidth: true, rows: 5 });
    expect(placed.width).toBe(280);
    expect(placed.left).toBe(16);
    expect(placed.top).toBeLessThan(field.y);
    expect(placed.top).toBeGreaterThanOrEqual(INSETS.top);
  });

  it('sits at the top right under the status bar until the trigger is measured', () => {
    const placed = placeMenu(null, SCREEN, INSETS, FIVE);
    expect(placed.top).toBeGreaterThan(INSETS.top);
    expect(placed.left + placed.width).toBeLessThanOrEqual(SCREEN.width);
  });
});
