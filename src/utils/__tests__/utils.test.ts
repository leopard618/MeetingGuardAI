import { getLocationString } from '../meetingHelpers';
import { safeGet, safeStringify } from '../index';
import {
  MOVED_TO_SERVER_CODE,
  MovedToServerError,
  isMovedToServerError,
  movedToServerMessage,
} from '../movedToServer';

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

describe('MovedToServerError', () => {
  it('carries a stable code and a bilingual message', () => {
    const error = new MovedToServerError('ai-assistant', 'es');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(MOVED_TO_SERVER_CODE);
    expect(error.feature).toBe('ai-assistant');
    expect(error.message).toBe(movedToServerMessage('ai-assistant', 'es'));
    expect(isMovedToServerError(error)).toBe(true);
    expect(isMovedToServerError(new Error('other'))).toBe(false);
  });

  it('falls back to English for unknown languages', () => {
    expect(movedToServerMessage('google-sign-in', 'fr')).toBe(
      movedToServerMessage('google-sign-in', 'en'),
    );
  });
});
