import { AppError } from '../../errors.ts';
import type { CatalogueDatabase } from './catalogue.ts';

export interface SyncBudget { dailyWrittenRows: number; dailyQueueOperations: number; }
export const DEFAULT_SYNC_BUDGET: SyncBudget = { dailyWrittenRows: 80_000, dailyQueueOperations: 8_000 };
export class QuotaExhaustedError extends AppError {
  readonly retryAt: string;
  constructor(now: Date) {
    super(429, 'IMPORT_QUOTA_PAUSED', 'The configured daily import allowance is exhausted. Progress is saved; application capacity remains reserved.');
    this.retryAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  }
}
export async function reserveWriteBudget(db: CatalogueDatabase, id: string, writes: number, queueOperations = 0, budget = DEFAULT_SYNC_BUDGET, now = new Date()) {
  if (!Number.isSafeInteger(writes) || writes < 0 || !Number.isSafeInteger(queueOperations) || queueOperations < 0 || !Number.isSafeInteger(budget.dailyWrittenRows) || budget.dailyWrittenRows < 1 || budget.dailyWrittenRows > 80_000 || !Number.isSafeInteger(budget.dailyQueueOperations) || budget.dailyQueueOperations < 1 || budget.dailyQueueOperations > 8_000)
    throw new AppError(400, 'INVALID_BUDGET', 'Import budgets must reserve at least 20,000 daily row writes and 2,000 queue operations for other traffic.');
  const day = now.toISOString().slice(0, 10); const timestamp = now.toISOString();
  const reservation = `${day}:${id}`;
  // One D1 batch is atomic: only the successful conditional reservation charges its budget.
  await db.batch([
    db.prepare('INSERT INTO cloud_daily_budget(day,writes_reserved,queue_operations_reserved,updated_at) VALUES(?,0,0,?) ON CONFLICT(day) DO NOTHING').bind(day, timestamp),
    db.prepare(`INSERT INTO cloud_budget_reservations(id,day,writes_reserved,queue_operations_reserved,created_at) SELECT ?,day,?,?,? FROM cloud_daily_budget WHERE day=? AND writes_reserved+?<=? AND queue_operations_reserved+?<=? ON CONFLICT(id) DO NOTHING`).bind(reservation, writes, queueOperations, timestamp, day, writes, budget.dailyWrittenRows, queueOperations, budget.dailyQueueOperations),
    db.prepare('UPDATE cloud_daily_budget SET writes_reserved=writes_reserved+?,queue_operations_reserved=queue_operations_reserved+?,updated_at=? WHERE day=? AND changes()=1').bind(writes, queueOperations, timestamp, day),
  ]);
  const found = await db.prepare('SELECT writes_reserved,queue_operations_reserved FROM cloud_budget_reservations WHERE id=?').bind(reservation).first<{ writes_reserved: number; queue_operations_reserved: number }>();
  if (!found) throw new QuotaExhaustedError(now);
  if (found.writes_reserved !== writes || found.queue_operations_reserved !== queueOperations) throw new AppError(409, 'RESERVATION_CONFLICT', 'This import reservation already has different costs.');
  return { id: reservation, day, writes, queueOperations };
}

export async function getWriteBudget(db: CatalogueDatabase, budget = DEFAULT_SYNC_BUDGET, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const row = await db.prepare('SELECT writes_reserved,queue_operations_reserved FROM cloud_daily_budget WHERE day=?').bind(day).first<{ writes_reserved: number; queue_operations_reserved: number }>();
  return { day, writtenRowsReserved: row?.writes_reserved ?? 0, queueOperationsReserved: row?.queue_operations_reserved ?? 0, limits: budget, accountScope: 'Shared catalogue and research import allowance; external account usage and application traffic must fit the separately reserved capacity.' };
}

/** Settle only a measured successful batch. Interrupted/uncertain outcomes keep the conservative charge. */
export async function settleWriteBudget(db: CatalogueDatabase, reservationId: string, measuredWrites: number) {
  if (!Number.isSafeInteger(measuredWrites) || measuredWrites < 0) return;
  const reservation = await db.prepare('SELECT day,writes_reserved,settled_writes FROM cloud_budget_reservations WHERE id=?').bind(reservationId).first<{ day: string; writes_reserved: number; settled_writes: number | null }>();
  if (!reservation || reservation.settled_writes != null) return;
  // An underestimated write must be charged even if it pushes this day over its allowance.
  // Subsequent reservations then fail closed; a measured write cannot be undone or hidden.
  const settled = measuredWrites + 16;
  const refund = reservation.writes_reserved - settled;
  await db.batch([
    db.prepare('UPDATE cloud_daily_budget SET writes_reserved=writes_reserved-?,updated_at=? WHERE day=? AND EXISTS(SELECT 1 FROM cloud_budget_reservations WHERE id=? AND settled_writes IS NULL)').bind(refund, new Date().toISOString(), reservation.day, reservationId),
    db.prepare('UPDATE cloud_budget_reservations SET settled_writes=? WHERE id=? AND settled_writes IS NULL').bind(settled, reservationId),
  ]);
}
