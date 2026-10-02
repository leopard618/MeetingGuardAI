import type { WhatsAppLinkStatus } from '../../../core/contracts';
import { AppError } from '../../../core/errors';
import { actionErrorKey, codeMessageUrl, connectView, formatCountdown, remainingSeconds } from '../whatsappConnectModel';

const ENABLED: WhatsAppLinkStatus = {
  enabled: true,
  linked: false,
  displayNumber: '+1 555 025 3483',
  deepLink: 'https://wa.me/15550253483',
};

describe('connectView', () => {
  it('maps the status/error pair to the five views', () => {
    expect(connectView(null, null)).toBe('loading');
    expect(connectView(null, new AppError('offline'))).toBe('error');
    expect(connectView({ enabled: false, linked: false, displayNumber: null, deepLink: null }, null)).toBe('unavailable');
    expect(connectView(ENABLED, null)).toBe('not_linked');
    expect(connectView({ ...ENABLED, linked: true }, null)).toBe('linked');
  });

  it('prefers the loaded status over a stale refresh error', () => {
    expect(connectView(ENABLED, new AppError('offline'))).toBe('not_linked');
  });
});

describe('remainingSeconds + formatCountdown', () => {
  const now = new Date('2026-10-02T10:00:00.000Z');

  it('counts whole seconds down to 0 and clamps the past', () => {
    expect(remainingSeconds('2026-10-02T10:09:07.000Z', now)).toBe(547);
    expect(remainingSeconds('2026-10-02T10:00:00.500Z', now)).toBe(0);
    expect(remainingSeconds('2026-10-02T09:59:59.000Z', now)).toBe(0);
    expect(remainingSeconds('not a date', now)).toBe(0);
  });

  it('renders m:ss', () => {
    expect(formatCountdown(547)).toBe('9:07');
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('codeMessageUrl', () => {
  it('prefills the code as the wa.me message text', () => {
    expect(codeMessageUrl('https://wa.me/15550253483', '004217')).toBe('https://wa.me/15550253483?text=004217');
  });
});

describe('actionErrorKey', () => {
  it('gives the server rate limit its own message', () => {
    expect(actionErrorKey(new AppError('quota_exceeded', 'x', { details: { reason: 'rate_limited' } }))).toBe('whatsapp:error.rateLimited');
    expect(actionErrorKey(new AppError('quota_exceeded'))).toBe('whatsapp:error.rateLimited');
  });

  it('reuses the unavailable notice and the shared transport messages', () => {
    expect(actionErrorKey(new AppError('not_configured'))).toBe('whatsapp:status.unavailable');
    expect(actionErrorKey(new AppError('offline'))).toBe('common:errors.offline');
    expect(actionErrorKey(new AppError('timeout'))).toBe('common:errors.timeout');
    expect(actionErrorKey(new AppError('unauthenticated'))).toBe('common:errors.unauthenticated');
  });

  it('falls back to the generic message', () => {
    expect(actionErrorKey(new AppError('upstream_error'))).toBe('whatsapp:error.generic');
    expect(actionErrorKey(new AppError('unknown'))).toBe('whatsapp:error.generic');
  });
});
