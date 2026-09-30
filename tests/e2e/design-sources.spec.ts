import { expect, test, type Page, type Route } from '@playwright/test';

const sources = [
  { id: 'source-a', name: 'Source A', kind: 'site', url: 'https://a.example', researchStatus: 'observed', evidenceClass: 'direct', observedAt: '2026-09-12', provenancePath: 'report-a.md', reviewState: null, hasImplementedCapability: 0 },
  { id: 'source-b', name: 'Source B', kind: 'provider', url: 'https://b.example', researchStatus: 'verified', evidenceClass: 'direct', observedAt: '2026-09-12', provenancePath: 'report-b.md', reviewState: null, hasImplementedCapability: 1 },
];
const detail = (id: string, truncated = false) => ({
  source: { id }, evidence: { marker: `${id}-evidence` }, categories: ['catalogue'],
  relationships: truncated ? [{ id: 'r1' }, { id: 'r2' }] : [], relationshipsTruncated: truncated,
  capabilities: [], reviews: [],
});
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function mockOperatorApi(page: Page, handler?: (route: Route, url: URL) => Promise<boolean>) {
  await page.route('**/api/admin/sources**', async route => {
    const url = new URL(route.request().url());
    expect(route.request().headers()['x-admin-token']).toBe('operator-secret');
    if (handler && await handler(route, url)) return;
    if (url.pathname === '/api/admin/sources/coverage') return json(route, { categories: [{ category: 'catalogue', count: 2 }], statuses: [{ status: 'observed', count: 1 }], counts: {}, denominatorScope: 'Observable test records.' });
    if (url.pathname === '/api/admin/sources') return json(route, { items: sources, total: 2, page: 1, pages: 1 });
    if (url.pathname === '/api/admin/sources/source-a') return json(route, detail('source-a'));
    if (url.pathname === '/api/admin/sources/source-b') return json(route, detail('source-b'));
    if (url.pathname.endsWith('/review')) return json(route, { capabilitiesChanged: false });
    return json(route, { code: 'NOT_FOUND', message: 'Unexpected test endpoint.' }, 404);
  });
}

async function unlock(page: Page) {
  await page.goto('/admin/sources');
  await page.getByLabel('Operator token').fill('operator-secret');
  await page.getByRole('button', { name: 'Unlock sources' }).click();
  await expect(page.getByRole('button', { name: /^Source A/ })).toBeVisible();
}

test('operator authorization is memory-only and lock rejects late review/detail state', async ({ page }) => {
  await mockOperatorApi(page, async (route, url) => {
    if (url.pathname === '/api/admin/sources/source-a/review') {
      await new Promise(resolve => setTimeout(resolve, 500));
      try { await json(route, { capabilitiesChanged: false }); } catch {}
      return true;
    }
    return false;
  });
  await unlock(page);
  const persisted = JSON.stringify(
    await page.evaluate(() => ({ local: Object.values(localStorage), session: Object.values(sessionStorage) })),
  );
  expect(persisted).not.toContain('operator-secret');
  await page.getByRole('button', { name: /^Source A/ }).click();
  await page.getByText('Source evidence', { exact: true }).click();
  await expect(page.getByText('source-a-evidence')).toBeVisible();
  await page.getByLabel('Review note').fill('A bounded operator note');
  await page.getByRole('button', { name: 'Save review' }).click();
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unlock sources' })).toBeVisible();
  await page.waitForTimeout(650);
  await expect(page.getByRole('button', { name: 'Unlock sources' })).toBeVisible();
  await expect(page.getByText('source-a-evidence')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Unlock sources' })).toBeVisible();
});

test('new selection rejects stale details and detail errors expose a working retry', async ({ page }) => {
  let aRequests = 0;
  await mockOperatorApi(page, async (route, url) => {
    if (url.pathname !== '/api/admin/sources/source-a') return false;
    aRequests++;
    if (aRequests === 1) {
      await new Promise(resolve => setTimeout(resolve, 350));
      try { await json(route, detail('source-a')); } catch {}
    } else if (aRequests === 2) {
      await json(route, { error: { code: 'UPSTREAM', message: 'Evidence store unavailable.' } }, 503);
    } else await json(route, detail('source-a'));
    return true;
  });
  await unlock(page);
  await page.getByRole('button', { name: /^Source A/ }).click();
  await page.getByRole('button', { name: /^Source B/ }).click();
  await page.getByText('Source evidence', { exact: true }).click();
  await expect(page.getByText('source-b-evidence')).toBeVisible();
  await page.waitForTimeout(450);
  await expect(page.getByText('source-a-evidence')).toHaveCount(0);
  await page.getByRole('button', { name: /^Source A/ }).click();
  await expect(page.getByRole('button', { name: 'Retry details' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry details' }).click();
  await page.getByText('Source evidence', { exact: true }).click();
  await expect(page.getByText('source-a-evidence')).toBeVisible();
});

test('relationship continuation uses the returned cursor and reaches exhaustion', async ({ page }) => {
  let continuation = '';
  await mockOperatorApi(page, async (route, url) => {
    if (url.pathname === '/api/admin/sources/source-a') {
      await json(route, detail('source-a', true));
      return true;
    }
    if (url.pathname === '/api/admin/sources/source-a/relationships') {
      continuation = url.searchParams.get('after') ?? '';
      await json(route, { items: [{ id: 'r3' }], nextCursor: null });
      return true;
    }
    return false;
  });
  await unlock(page);
  await page.getByRole('button', { name: /^Source A/ }).click();
  await page.getByText(/^Relationships/).click();
  await page.getByRole('button', { name: 'Load more relationships' }).click();
  await expect(page.getByText('All relationships loaded.')).toBeVisible();
  await expect(page.getByText('Relationships (3)', { exact: true })).toBeVisible();
  expect(continuation).toBe('r2');
});

test('evidence fragments load in bounded pages and stale chunks cannot cross selections', async ({ page }) => {
  const offsets: string[] = [];
  await mockOperatorApi(page, async (route, url) => {
    if (url.pathname === '/api/admin/sources/source-a/evidence') {
      offsets.push(url.searchParams.get('offset') ?? '');
      if (offsets.length === 1) {
        await json(route, { items: [{ fragmentIndex: 0, content: '{"source":"a",' }], nextOffset: 1, format: 'test' });
      } else {
        await new Promise(resolve => setTimeout(resolve, 350));
        try { await json(route, { items: [{ fragmentIndex: 1, content: '"late":true}' }], nextOffset: null, format: 'test' }); } catch {}
      }
      return true;
    }
    return false;
  });
  await unlock(page);
  await page.getByRole('button', { name: /^Source A/ }).click();
  await page.getByText(/^Extended evidence fragments/).click();
  await page.getByRole('button', { name: 'Load evidence fragments' }).click();
  await expect(page.getByLabel('Loaded evidence fragments')).toContainText('{"source":"a",');
  await page.getByRole('button', { name: 'Load next evidence fragments' }).click();
  await page.getByRole('button', { name: /^Source B/ }).click();
  await page.waitForTimeout(450);
  await expect(page.getByLabel('Loaded evidence fragments')).toHaveCount(0);
  expect(offsets).toEqual(['0', '1']);
});

test('evidence fragment failures expose a retry without discarding the source detail', async ({ page }) => {
  let attempts = 0;
  await mockOperatorApi(page, async (route, url) => {
    if (url.pathname !== '/api/admin/sources/source-a/evidence') return false;
    attempts++;
    if (attempts === 1) {
      await json(route, { error: { code: 'UNAVAILABLE', message: 'Fragment store unavailable.' } }, 503);
    } else {
      await json(route, { items: [{ fragmentIndex: 0, content: '{"recovered":true}' }], nextOffset: null, format: 'test' });
    }
    return true;
  });
  await unlock(page);
  await page.getByRole('button', { name: /^Source A/ }).click();
  await page.getByText(/^Extended evidence fragments/).click();
  await page.getByRole('button', { name: 'Load evidence fragments' }).click();
  await expect(page.getByText('Fragment store unavailable.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Retry evidence fragments' }).click();
  await expect(page.getByLabel('Loaded evidence fragments')).toContainText('{"recovered":true}');
  await expect(page.getByRole('heading', { name: 'Source A', exact: true })).toBeVisible();
});

const cloudStatus = (jobs: unknown[] = []) => ({
  runtime: 'cloudflare-workers',
  backupMode: 'operator-cli',
  syncEnabled: true,
  sourceRefreshEnabled: false,
  counts: { titles: 275, episodes: 0, versions: 0, mappings: 0, pendingTasks: 1 },
  latestRun: null,
  coverage: null,
  taskStages: [],
  recentErrors: [],
  providers: [],
  cloudBudget: {
    day: '2026-09-12',
    writtenRowsReserved: 1200,
    queueOperationsReserved: 20,
    limits: { dailyWrittenRows: 80000, dailyQueueOperations: 8000 },
    accountScope: 'Shared import allowance.',
  },
  snapshot: { jobs, storage: 'private_worker_assets', publicAssetServing: false },
});

async function unlockDiagnostics(page: Page) {
  await page.goto('/admin');
  await page.getByLabel('Operator token').fill('operator-secret');
  await page.getByRole('button', { name: 'Open console' }).click();
}

test('cloud diagnostics keep authorization in memory and reject a late import after lock', async ({
  page,
}) => {
  await page.route('**/api/admin/import/**', async (route) => {
    expect(route.request().headers()['x-admin-token']).toBe('operator-secret');
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/import/status') return json(route, cloudStatus());
    if (url.pathname === '/api/admin/import/start') {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        await json(route, { job: { id: 'snapshot-a', runId: 1000000001, created: true } });
      } catch {}
      return;
    }
    return json(route, { error: { message: 'Unexpected endpoint' } }, 404);
  });
  await unlockDiagnostics(page);
  await expect(page.getByText('1,200 / 80,000')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create backup' })).toHaveCount(0);
  await expect(page.getByText('wrangler d1 export', { exact: false })).toBeVisible();
  const persisted = JSON.stringify(
    await page.evaluate(() => ({ local: Object.values(localStorage), session: Object.values(sessionStorage) })),
  );
  expect(persisted).not.toContain('operator-secret');
  await page.getByRole('button', { name: 'Start cloud import' }).click();
  await page.getByRole('button', { name: 'Lock screen' }).click();
  await page.waitForTimeout(650);
  await expect(page.getByRole('button', { name: 'Open console' })).toBeVisible();
  await expect(page.getByText(/snapshot-a was queued/i)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open console' })).toBeVisible();
});

test('cloud snapshot progress controls the durable run id', async ({ page }) => {
  let actionPath = '';
  const jobs = [
    {
      id: 'snapshot-a',
      runId: 1000000001,
      status: 'running',
      importedBatches: 3,
      totalBatches: 8,
      totalRows: 12000,
      availableAt: null,
      errorCode: null,
      errorMessage: null,
    },
  ];
  await page.route('**/api/admin/import/**', async (route) => {
    expect(route.request().headers()['x-admin-token']).toBe('operator-secret');
    const url = new URL(route.request().url());
    if (url.pathname === '/api/admin/import/status') return json(route, cloudStatus(jobs));
    actionPath = url.pathname;
    return json(route, { runId: 1000000001, status: 'paused' });
  });
  await unlockDiagnostics(page);
  await expect(page.getByText('3 / 8', { exact: true })).toBeVisible();
  await expect(page.getByText('12,000', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start cloud import' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Run 1000000001 paused.')).toBeVisible();
  expect(actionPath).toBe('/api/admin/import/1000000001/pause');
});

test('cloud diagnostics explain quota-paused dispatch without trusting a stale task retry', async ({
  page,
}) => {
  const jobs = [
    {
      id: 'snapshot-quota',
      runId: 1000000002,
      status: 'running',
      importedBatches: 5,
      totalBatches: 9,
      totalRows: 73895,
      availableAt: '2026-09-12T18:00:00.000Z',
      errorCode: null,
      errorMessage: null,
    },
  ];
  await page.route('**/api/admin/import/status', async (route) => {
    await json(route, {
      ...cloudStatus(jobs),
      dispatchAllowance: {
        status: 'quota_paused',
        retryAt: '2026-09-13T00:00:00.000Z',
        minimumHeadroom: { writtenRows: 1500, queueOperations: 3 },
      },
    });
  });
  await unlockDiagnostics(page);
  const quotaNotice = page.getByRole('status').filter({ hasText: 'Daily import dispatch is paused' });
  await expect(quotaNotice).toBeVisible();
  await expect(quotaNotice).toContainText('2026-09-13 00:00:00 UTC');
  await expect(quotaNotice).toContainText('1,500 writable rows and 3 queue operations');
  await expect(page.getByText('Quota resumes 2026-09-13 00:00:00 UTC')).toBeVisible();
  await expect(page.getByText(/2026-09-12.*18:00/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Retry failed', exact: true })).toBeDisabled();
});
