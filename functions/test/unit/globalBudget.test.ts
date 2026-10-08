import { createGlobalBudget, type GlobalBudgetStore } from '../../src/assistant/globalBudget';

function memoryStore(initial = 0) {
  const totals = new Map<string, number>();
  const reads: string[] = [];
  const store: GlobalBudgetStore = {
    async readTotal(dayKey) {
      reads.push(dayKey);
      return totals.get(dayKey) ?? initial;
    },
    async increment(dayKey) {
      totals.set(dayKey, (totals.get(dayKey) ?? initial) + 1);
    },
  };
  return { store, totals, reads };
}

describe('createGlobalBudget', () => {
  it('lets requests through until the daily cap and counts each one', async () => {
    const { store, totals } = memoryStore();
    let now = 0;
    const budget = createGlobalBudget(store, { limit: () => 2, cacheMs: 1_000, now: () => now });
    expect(await budget.tryAcquire('2026-10-05')).toBe(true);
    expect(await budget.tryAcquire('2026-10-05')).toBe(true);
    expect(await budget.tryAcquire('2026-10-05')).toBe(false);
    expect(totals.get('2026-10-05')).toBe(2);
    // A new UTC day starts from its own counter.
    now = 10;
    expect(await budget.tryAcquire('2026-10-06')).toBe(true);
  });

  it('caches the total per instance and re-reads it after the cache period', async () => {
    const { store, reads } = memoryStore(100);
    let now = 0;
    const budget = createGlobalBudget(store, { limit: () => 1000, cacheMs: 60_000, now: () => now });
    await budget.tryAcquire('d');
    await budget.tryAcquire('d');
    expect(reads).toEqual(['d']);
    now = 61_000;
    await budget.tryAcquire('d');
    expect(reads).toEqual(['d', 'd']);
  });

  it('is disabled by a non-positive limit', async () => {
    const { store, reads } = memoryStore(10_000);
    const budget = createGlobalBudget(store, { limit: () => 0 });
    expect(await budget.tryAcquire('d')).toBe(true);
    expect(reads).toEqual([]);
  });
});
