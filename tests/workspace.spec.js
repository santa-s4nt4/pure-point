import { test, expect } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { readFile } from 'node:fs/promises';

async function saveAndReopen(page, path) {
  await page.locator('.p-menu').click();
  const ready = page.waitForEvent('download');
  await page.locator('[data-action=saveAs]').click();
  await (await ready).saveAs(path);
  await page.locator('.p-menu').click();
  const pick = page.waitForEvent('filechooser');
  await page.locator('[data-action=open]').click();
  await (await pick).setFiles(path);
  await expect(page.locator('#status')).toHaveText('Saved');
}

test('Navigator, slide sections, hidden slides, and comments survive reopening', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.locator('.doc-name')).toHaveText('untitled.pptx');
  const rail = page.locator('.rail'),
    stage = page.locator('.stage'),
    splitter = page.getByRole('separator', { name: 'Resize slide navigator' });
  const original = await rail.boundingBox(),
    bar = await splitter.boundingBox();
  await page.mouse.move(bar.x + 3, bar.y + 100);
  await page.mouse.down();
  await page.mouse.move(bar.x + 65, bar.y + 100);
  await page.mouse.up();
  expect((await rail.boundingBox()).width).toBeGreaterThan(original.width + 50);
  for (let i = 0; i < 4; i++) {
    await rail.locator('[data-action=addSlide]').click();
    await page
      .getByRole('button', { name: 'タイトルのみ', exact: true })
      .click();
  }
  await rail.locator('[data-slide="1"]').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#slide-counter')).toHaveText('Slide 3 / 5');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#slide-counter')).toHaveText('Slide 2 / 5');
  await rail.locator('[data-slide="2"]').click({ modifiers: ['Shift'] });
  await rail.locator('[data-action=newSection]').click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Section name').fill('Process');
  await modal.getByRole('button', { name: 'Done' }).click();
  await expect(
    rail.locator('.section-label').filter({ hasText: 'Process' })
  ).toHaveCount(1);
  await rail.locator('[data-slide="3"]').click();
  await rail.locator('[data-hide-slide="3"]').click({ force: true });
  await page.locator('[data-action=comments]').click();
  await page.getByRole('button', { name: 'Place a comment pin' }).click();
  await stage.locator('.artboard').click({ position: { x: 100, y: 90 } });
  await page
    .getByLabel('Comment', { exact: true })
    .fill('Move this label slightly left.');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.locator('.comment-pin')).toHaveCount(1);
  await page.locator('footer [data-action=inspector]').click();
  await expect(page.locator('.inspector')).toBeHidden();
  await page.locator('footer [data-action=inspector]').click();
  await expect(page.locator('.inspector')).toBeVisible();
  await rail.locator('[data-action=overview]').click();
  await expect(page.locator('.sorter [data-slide]')).toHaveCount(5);
  const before = (
    await page.locator('.sorter .thumb-frame').first().boundingBox()
  ).width;
  await page.locator('.sorter').dispatchEvent('wheel', {
    deltaY: -70,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    clientX: 620,
    clientY: 220,
  });
  expect(
    (await page.locator('.sorter .thumb-frame').first().boundingBox()).width
  ).toBeGreaterThan(before);
  await page.locator('.sorter [data-slide="3"]').dblclick();
  await expect(page.locator('.sorter')).toBeHidden();
  const output = info.outputPath('review.pptx');
  await saveAndReopen(page, output);
  await expect(rail.locator('.slide-hidden')).toHaveCount(1);
  await expect(rail.getByText('Process')).toBeVisible();
  await rail.locator('[data-slide="3"]').click();
  await page.locator('[data-action=comments]').click();
  await expect(page.locator('.comment-card p')).toHaveText(
    'Move this label slightly left.'
  );
  const parts = unzipSync(await readFile(output));
  expect(strFromU8(parts['ppt/presentation.xml'])).toContain('Process');
});

test('Pinch preserves the canvas point, doubles create editable text, deck size stays widescreen', async ({
  page,
}) => {
  await page.goto('/');
  const art = page.locator('.artboard'),
    stage = page.locator('.stage');
  await expect(page.getByText('1920 × 1080 px')).toBeVisible();
  const b = await art.boundingBox(),
    x = b.x + b.width * 0.65,
    y = b.y + b.height * 0.55;
  await stage.dispatchEvent('wheel', {
    deltaY: -98,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  const after = await art.boundingBox();
  expect(after.width).toBeGreaterThan(b.width * 2);
  expect(Math.abs((x - after.x) / after.width - 0.65)).toBeLessThan(0.008);
  await page.locator('footer [data-action=fit]').click();
  await art.dblclick({ position: { x: 80, y: 80 } });
  const entry = page.getByRole('textbox', { name: 'Slide text' });
  await entry.fill('Double-click to write');
  await entry.press('Meta+Enter');
  await expect(art.locator('.item-text')).toHaveText('Double-click to write');
  await art.locator('.item-text').dblclick({ force: true });
  await expect(entry).toBeVisible();
});
