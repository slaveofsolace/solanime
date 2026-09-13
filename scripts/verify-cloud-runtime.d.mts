export function allowedCloudOrigin(value: unknown): boolean;
export function redactReceipt(value: unknown, secret?: string): unknown;
export function boundedJson(response: Response, maximum?: number): Promise<Record<string, unknown>>;
export function snapshotState(status: Record<string, unknown>, expected: { runId: number; cursor: number; totalBatches: number; snapshotId: string }): Record<string, unknown>;
export function exerciseSnapshotControls(
  api: (path: string, check: string, init?: { method?: string; body?: unknown }) => Promise<Record<string, unknown>>,
  initial: { enabled: boolean; snapshot: Record<string, unknown> },
  expected: { runId: number; cursor: number; totalBatches: number; snapshotId: string },
): Promise<Record<string, unknown>>;
export function verifyCloudRuntime(options: {
  origin?: string; token?: string; privateManifestPath?: string;
  exerciseControls?: boolean; fetchImpl?: typeof fetch; requestDelayMs?: number;
  expectedRunId?: number; expectedCursor?: number; expectedTotalBatches?: number;
}): Promise<Record<string, unknown>>;
