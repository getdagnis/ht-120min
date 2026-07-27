import { test, expect } from '@playwright/test';

const historyUrl = `${process.env.HISTORY_BASE_URL || 'http://127.0.0.1:3000'}/dummies/tournament-history`;

test('history archive keeps awards to three columns and accepts a final comment', async ({ page }) => {
  await page.goto(historyUrl);

  await expect(page.getByRole('heading', { name: 'Season 1 champions' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Season 2 Upcoming/ })).toBeDisabled();

  const awardPositions = await page
    .getByTestId('history-awards')
    .locator(':scope > article')
    .evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)));
  expect(awardPositions).toHaveLength(6);
  expect(new Set(awardPositions.slice(0, 3)).size).toBe(1);
  expect(awardPositions[3]).toBeGreaterThan(awardPositions[0]);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('Your final comment as Guåhan Goddesses').fill('A season worth remembering.');
  await page.getByRole('button', { name: 'Post final comment' }).click();
  await expect(page.getByText('A season worth remembering.')).toBeVisible();
  await expect(page.getByLabel('Your final comment as Guåhan Goddesses')).toHaveCount(0);
});

test('history archive becomes one column without horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(historyUrl);

  const columnCount = await page.getByTestId('history-columns').evaluate((element) => {
    return getComputedStyle(element).gridTemplateColumns.split(' ').length;
  });
  expect(columnCount).toBe(1);

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBe(false);
});
