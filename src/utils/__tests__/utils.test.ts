import { getLocationString } from '../meetingHelpers';
import { safeGet, safeStringify } from '../index';

describe('safeStringify', () => {
  it('handles primitives, null and objects', () => {
    expect(safeStringify(null)).toBe('');
    expect(safeStringify(undefined)).toBe('');
    expect(safeStringify('text')).toBe('text');
    expect(safeStringify(42)).toBe('42');
    expect(safeStringify(false)).toBe('false');
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
  });

  it('does not throw on circular objects', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(safeStringify(circular)).toBe('[Object]');
  });
});

describe('safeGet', () => {
  it('reads nested paths and falls back to the default', () => {
    const meeting = { location: { address: 'Main St 1' } };
    expect(safeGet(meeting, 'location.address')).toBe('Main St 1');
    expect(safeGet(meeting, 'location.city', 'n/a')).toBe('n/a');
    expect(safeGet(null, 'a.b', 'fallback')).toBe('fallback');
  });
});

describe('getLocationString', () => {
  it('formats the supported location shapes', () => {
    expect(getLocationString(undefined)).toBe('');
    expect(getLocationString('Office')).toBe('Office');
    expect(getLocationString({ type: 'virtual', virtualPlatform: 'zoom' })).toBe(
      'Virtual Meeting (zoom)',
    );
    expect(getLocationString({ type: 'hybrid', address: 'HQ', virtualPlatform: 'teams' })).toBe(
      'HQ + Virtual (teams)',
    );
    expect(getLocationString({ address: 'Main St 1' })).toBe('Main St 1');
  });
});
