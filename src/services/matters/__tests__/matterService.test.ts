import { CALLABLES, MATTER_CALL_TIMEOUT_MS } from '../../../core/aiContract';
import { AppError } from '../../../core/errors';
import { createMatterService, mapMatterError, type MatterTransport } from '../matterService';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../../config/firebase', () => ({ functions: null, isFirebaseReady: false }));

const HASH = 'a'.repeat(64);
const DRAFT = {
  matterId: 'm1',
  status: 'draft',
  title: 'Proposal from Carlos',
  readBack: 'I will email Carlos Ruiz (carlos@example.com).',
  questions: [],
  firstEmail: { from: 'x', to: ['carlos@example.com'], cc: [], subject: 'Proposal', text: 'Hello Carlos' },
  draftHash: HASH,
};

function httpsError(code: string, reason?: string): Error & { code: string; details?: unknown } {
  return Object.assign(new Error(code), { code, ...(reason ? { details: { reason } } : {}) });
}

function setup(answer: (name: string, request: unknown) => unknown, enabled = true) {
  const calls: { name: string; request: unknown; timeoutMs: number }[] = [];
  const transport: MatterTransport = {
    async call(name, request, options) {
      calls.push({ name, request, timeoutMs: options.timeoutMs });
      return answer(name, request);
    },
  };
  return { calls, service: createMatterService({ getTransport: () => transport, enabled: () => enabled }) };
}

describe('matterService', () => {
  it('drafts with the trimmed words, the language and the zone, and validates the answer', async () => {
    const { calls, service } = setup(() => DRAFT);
    await expect(service.draft({ text: '  Contact Carlos  ', source: 'text', language: 'es', timeZone: 'Europe/Madrid' })).resolves.toEqual(DRAFT);
    expect(calls).toEqual([
      {
        name: CALLABLES.matterDraft,
        request: { text: 'Contact Carlos', source: 'text', language: 'es', timeZone: 'Europe/Madrid' },
        timeoutMs: MATTER_CALL_TIMEOUT_MS,
      },
    ]);
  });

  it('revises, confirms with the hash and cancels', async () => {
    const { calls, service } = setup((name) =>
      name === CALLABLES.matterConfirm
        ? { matterId: 'm1', status: 'active', outcome: 'sent' }
        : name === CALLABLES.matterCancel
          ? { matterId: 'm1', status: 'cancelled' }
          : DRAFT,
    );
    await service.revise('m1', ' carlos@example.com ');
    await expect(service.confirm('m1', HASH)).resolves.toEqual({ matterId: 'm1', status: 'active', outcome: 'sent' });
    await expect(service.cancel('m1')).resolves.toEqual({ matterId: 'm1', status: 'cancelled' });
    expect(calls.map((c) => [c.name, c.request])).toEqual([
      [CALLABLES.matterRevise, { matterId: 'm1', answer: 'carlos@example.com' }],
      [CALLABLES.matterConfirm, { matterId: 'm1', draftHash: HASH }],
      [CALLABLES.matterCancel, { matterId: 'm1' }],
    ]);
  });

  it('refuses everything when the build has it switched off', async () => {
    const { calls, service } = setup(() => DRAFT, false);
    expect(service.isEnabled()).toBe(false);
    await expect(service.draft({ text: 'x', source: 'text', language: 'en', timeZone: 'UTC' })).rejects.toMatchObject({ code: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('rejects bad input before calling and a malformed answer after', async () => {
    const { calls, service } = setup(() => ({ nonsense: true }));
    await expect(service.confirm('m1', 'not-a-hash')).rejects.toMatchObject({ code: 'invalid_input' });
    expect(calls).toHaveLength(0);
    await expect(service.cancel('m1')).rejects.toMatchObject({ code: 'upstream_error' });
  });

  it('maps the server reasons and keeps them in details', async () => {
    const { service } = setup(() => {
      throw httpsError('functions/failed-precondition', 'stale_draft');
    });
    const error = await service.confirm('m1', HASH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'conflict', details: { reason: 'stale_draft' } });
    expect(mapMatterError(httpsError('functions/permission-denied', 'not_allowed'))).toMatchObject({ code: 'permission_denied' });
    expect(mapMatterError(httpsError('functions/resource-exhausted', 'rate_limited'))).toMatchObject({ code: 'quota_exceeded' });
    expect(mapMatterError(httpsError('functions/deadline-exceeded'))).toMatchObject({ code: 'timeout' });
  });
  it('A2: decides a card or a commitment through matterDecide, validated both ways', async () => {
    const answer = { matterId: 'm1', id: 'c1', status: 'approved', outcome: 'sent', taskId: null, matterStatus: 'active' };
    const { calls, service } = setup(() => answer);
    await expect(service.decide({ matterId: 'm1', target: 'approval', id: 'c1', action: 'approve', draftHash: HASH })).resolves.toEqual(answer);
    expect(calls[0]).toEqual({ name: CALLABLES.matterDecide, request: { matterId: 'm1', target: 'approval', id: 'c1', action: 'approve', draftHash: HASH }, timeoutMs: MATTER_CALL_TIMEOUT_MS });
    await expect(service.decide({ matterId: 'm1', target: 'approval', id: 'bad/id', action: 'approve' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('A2: asks matterView for the open matters and for one matter page', async () => {
    const item = { matterId: 'm1', status: 'active', title: 'Proposal', updatedAt: '2026-11-12T09:00:00.000Z', stopReason: null, pendingApprovals: 2 };
    const page = { matter: item, approvals: [], proposals: [] };
    const { calls, service } = setup((_name, request) => ((request as { matterId?: string }).matterId ? { matters: null, page } : { matters: [item], page: null }));
    await expect(service.listOpen()).resolves.toEqual([item]);
    await expect(service.getPage('m1')).resolves.toEqual(page);
    expect(calls.map((c) => [c.name, c.request])).toEqual([
      [CALLABLES.matterView, {}],
      [CALLABLES.matterView, { matterId: 'm1' }],
    ]);
    await expect(service.getPage('bad/id')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('A3: pauses, drafts and confirms a change, asks and speaks, with validated requests and answers', async () => {
    const CHANGE = { ...DRAFT, status: 'active', firstEmail: null };
    const { calls, service } = setup((name) => {
      if (name === CALLABLES.matterSetStatus) return { matterId: 'm1', status: 'paused' };
      if (name === CALLABLES.matterChange) return CHANGE;
      if (name === CALLABLES.matterAsk) return { intent: 'status', matterId: 'm1', title: 'Proposal from Carlos', answer: 'No reply yet.' };
      return { audioBase64: 'aGVsbG8=', chars: 13, estCostUsd: 0.0002 };
    });
    await expect(service.setStatus('m1', 'pause')).resolves.toEqual({ matterId: 'm1', status: 'paused' });
    await expect(service.change('m1', ' Move it to Monday ')).resolves.toEqual(CHANGE);
    await service.confirmChange('m1', HASH);
    await expect(service.ask({ text: ' News? ', language: 'es', matterId: 'm1' })).resolves.toMatchObject({ intent: 'status' });
    await expect(service.speak({ text: 'No reply yet.', language: 'en' })).resolves.toMatchObject({ chars: 13 });
    expect(calls.map((c) => [c.name, c.request])).toEqual([
      [CALLABLES.matterSetStatus, { matterId: 'm1', action: 'pause' }],
      [CALLABLES.matterChange, { matterId: 'm1', text: 'Move it to Monday' }],
      [CALLABLES.matterChange, { matterId: 'm1', draftHash: HASH }],
      [CALLABLES.matterAsk, { text: 'News?', language: 'es', matterId: 'm1' }],
      [CALLABLES.matterSpeak, { text: 'No reply yet.', language: 'en' }],
    ]);
    await expect(service.confirmChange('m1', 'short')).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
