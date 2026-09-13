import { describe, expect, it } from 'vitest';
import { dispatchAllowance } from '../server/cloud/worker.ts';

const usage = { day: '2026-09-12', writtenRowsReserved: 73_500, queueOperationsReserved: 0, limits: { dailyWrittenRows: 75_000, dailyQueueOperations: 2500 }, accountScope: 'isolated test' };
const date = new Date('2026-09-12T19:00:00Z');

describe('observable import dispatch allowance', () => {
  it('uses the same exact conservative headroom as the dispatcher', () => {
    expect(dispatchAllowance(usage, date)).toMatchObject({ status: 'available', retryAt: null });
    expect(dispatchAllowance({ ...usage, writtenRowsReserved: 73_501 }, date)).toMatchObject({ status: 'quota_paused', retryAt: '2026-09-13T00:00:00.000Z', minimumHeadroom: { writtenRows: 1500, queueOperations: 3 } });
  });
  it('also reports queue allowance exhaustion and permits the new UTC window', () => {
    expect(dispatchAllowance({ ...usage, queueOperationsReserved: 2498 }, date).status).toBe('quota_paused');
    expect(dispatchAllowance({ ...usage, day: '2026-09-13', writtenRowsReserved: 0, queueOperationsReserved: 0 }, new Date('2026-09-13T00:00:00Z')).status).toBe('available');
  });
});
