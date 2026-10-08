/**
 * Regression: pushed Google events carried no Zoom/Teams link in their body, so attendee
 * invitation emails had no way to join (user report, 2026-10-02). Non-Meet conference links and
 * passcodes are appended to the event description and stripped again on import.
 */
import { appendJoinBlock, stripJoinBlock } from '../../shared';

const ZOOM = { provider: 'zoom', url: 'https://us05web.zoom.us/j/89683659353', password: '5gyKjU' } as const;

describe('appendJoinBlock / stripJoinBlock', () => {
  it('appends link and passcode in English', () => {
    const out = appendJoinBlock('test', ZOOM, 'en');
    expect(out).toBe('test\n\nJoin: https://us05web.zoom.us/j/89683659353\nPasscode: 5gyKjU');
  });

  it('appends in Spanish and without a passcode', () => {
    const out = appendJoinBlock('', { ...ZOOM, password: null }, 'es');
    expect(out).toBe('Unirse: https://us05web.zoom.us/j/89683659353');
  });

  it('never duplicates on repeated pushes', () => {
    const once = appendJoinBlock('test', ZOOM, 'en');
    const twice = appendJoinBlock(once, ZOOM, 'en');
    expect(twice).toBe(once);
  });

  it('round trip: import strips the block back to the original description', () => {
    const pushed = appendJoinBlock('agenda line', ZOOM, 'en');
    expect(stripJoinBlock(pushed)).toBe('agenda line');
    const pushedEs = appendJoinBlock('agenda', { ...ZOOM, password: 'abc' }, 'es');
    expect(stripJoinBlock(pushedEs)).toBe('agenda');
  });

  it('leaves Google Meet to the native conference field', () => {
    expect(appendJoinBlock('desc', { provider: 'google_meet', url: 'https://meet.google.com/x', password: null }, 'en')).toBe('desc');
  });
});
