import { expect, test } from '@playwright/test';

const pending = {
  id: 'fixture-pending', email: 'new.viewer@example.test', approval_state: 'pending', approval_requested_at: 1790700000000,
};
const second = {
  id: 'fixture-second', email: 'second.viewer@example.test', approval_state: 'pending', approval_requested_at: 1790600000000,
};

const status = {
  runtime: 'cloudflare-workers', backupMode: 'operator-cli', syncEnabled: false,
  sourceRefreshEnabled: false, counts: { titles: 0, episodes: 0, versions: 0, mappings: 0, pendingTasks: 0 },
  latestRun: null, coverage: null, taskStages: [], recentErrors: [], providers: [],
  snapshot: { jobs: [], storage: 'private_worker_assets', publicAssetServing: false },
};

test('operator requests fit narrow and desktop layouts with reachable decisions', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/admin/import/status', async (route) => {
    expect(route.request().headers()['x-admin-token']).toBe('fixture-operator-token');
    await route.fulfill({ json: status });
  });
  await page.route('**/api/admin/accounts/pending', async (route) => {
    expect(route.request().headers()['x-admin-token']).toBe('fixture-operator-token');
    await route.fulfill({ json: { items: [pending, second] } });
  });
  await page.goto('/admin');
  await page.getByLabel('Operator token').fill('fixture-operator-token');
  await page.getByRole('button', { name: 'Open console' }).click();
  await expect(page.getByText('2 awaiting decision')).toBeVisible();

  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: width === 320 ? 812 : 1000 });
    const queue = page.locator('.approval-queue');
    await expect(queue.getByRole('button', { name: 'Approve' })).toHaveCount(2);
    await expect(queue.getByRole('button', { name: 'Decline' })).toHaveCount(2);
    await expect(queue.getByRole('button', { name: 'Approve' }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await queue.screenshot({ path: info.outputPath(`approval-queue-${width}.png`) });
  }

  await page.setViewportSize({ width: 320, height: 812 });
  await page.getByRole('button', { name: 'Approve' }).first().click();
  await expect(page.getByRole('button', { name: 'Confirm approval' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Decline' }).first().click();
  await expect(page.getByRole('button', { name: 'Confirm decline' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
