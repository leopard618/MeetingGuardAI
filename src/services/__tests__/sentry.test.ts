import { scrubBreadcrumb } from '../sentry';

describe('scrubBreadcrumb', () => {
  it('drops the raw console arguments (whole objects) and scrubs emails from the message', () => {
    const scrubbed = scrubBreadcrumb({
      category: 'console',
      message: 'Invalid meeting data: [object Object] ana@example.com',
      data: { arguments: ['Invalid meeting data:', { title: 'Salary review', conference: { password: 'secret' } }], logger: 'console' },
    });
    expect(scrubbed.data).toBeUndefined();
    expect(scrubbed.message).toBe('Invalid meeting data: [object Object] [email]');
    expect(JSON.stringify(scrubbed)).not.toMatch(/secret|Salary/);
  });

  it('removes query strings from HTTP breadcrumbs', () => {
    const scrubbed = scrubBreadcrumb({
      category: 'fetch',
      data: { url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events?syncToken=abc&timeMin=x', method: 'GET' },
    });
    expect(scrubbed.data).toEqual({ url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events', method: 'GET' });
  });

  it('leaves other breadcrumbs intact apart from email scrubbing', () => {
    expect(scrubBreadcrumb({ category: 'navigation', message: 'to Settings', data: { to: 'Settings' } })).toEqual({
      category: 'navigation',
      message: 'to Settings',
      data: { to: 'Settings' },
    });
  });
});
