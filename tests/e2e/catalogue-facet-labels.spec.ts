import { expect, test } from '@playwright/test';

test('scoped catalogue filters do not show global facet counts', async ({ page }) => {
  await page.goto('/catalogue?scope=anime');
  await expect(page.getByRole('heading', { name: 'Anime' })).toBeVisible();
  await expect(page.locator('.catalogue-summary')).toHaveText('32 titles');

  await page.locator('.filter-disclosure summary').click();
  const genre = page.getByRole('combobox', { name: 'Genre' });
  const format = page.getByRole('combobox', { name: 'Format' });
  await expect(genre.locator('option')).toContainText(['All genre', 'Adventure', 'Drama']);
  await expect(format.locator('option')).toContainText(['All format', 'Movie', 'TV']);
  await expect(genre.locator('option', { hasText: /\(34\)/ })).toHaveCount(0);
  await expect(format.locator('option', { hasText: /\(\d+\)/ })).toHaveCount(0);

  if ((page.viewportSize()?.width ?? 0) <= 600) {
    const surface = await page.locator('.filter-grid').evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, backdropFilter: style.backdropFilter };
    });
    expect(surface.background).toMatch(/^rgb\(/);
    expect(surface.backdropFilter).toBe('none');
  }
});
