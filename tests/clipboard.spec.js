import { expect, test } from '@playwright/test';

test('Copy and paste selected objects and groups across slides as one undoable edit', async ({
  page,
}) => {
  await page.goto('/');
  const art = page.locator('.artboard'),
    items = art.locator('.scene > .item[data-id]');
  for (const [label, x] of [
    ['Left', 65],
    ['Right', 180],
  ]) {
    await art.dblclick({ position: { x, y: 65 } });
    const editor = page.getByRole('textbox', { name: 'Slide text' });
    await editor.fill(label);
    await editor.press('Meta+Enter');
  }
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Meta+c');
  await page.keyboard.press('Meta+v');
  await expect(items).toHaveCount(4);
  expect(await items.locator('.item-text').allTextContents()).toEqual([
    'Left',
    'Right',
    'Left',
    'Right',
  ]);
  expect(
    new Set(await items.evaluateAll((nodes) => nodes.map((n) => n.dataset.id)))
      .size
  ).toBe(4);
  await page.keyboard.press('Meta+z');
  await expect(items).toHaveCount(2);
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Meta+g');
  await page.keyboard.press('Meta+c');
  await page.locator('.rail [data-action=addSlide]').click();
  await page.getByRole('button', { name: 'header title', exact: true }).click();
  await expect(page.locator('#slide-counter')).toHaveText('Slide 2 / 2');
  await page.keyboard.press('Meta+v');
  const group = art.locator('.item:has(> .group-content)');
  await expect(
    art.locator('.item-text').filter({ hasText: 'Right' })
  ).toBeVisible();
  await expect(items).toHaveCount(2);
  await page.keyboard.press('Meta+Shift+g');
  await expect(items).toHaveCount(3);
  await expect(group).toHaveCount(0);
});

test('Layer and canvas menus copy objects and text editing uses the text clipboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const art = page.locator('.artboard'),
    items = art.locator('.scene > .item[data-id]');
  await art.dblclick({ position: { x: 65, y: 65 } });
  const editor = page.getByRole('textbox', { name: 'Slide text' });
  await editor.fill('Original');
  await editor.press('Meta+Enter');
  await page.locator('[data-action=layers]').click();
  await page.locator('.layer-row').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Copy/ }).click();
  await art.click({ button: 'right', position: { x: 300, y: 110 } });
  await page.getByRole('menuitem', { name: /^Paste/ }).click();
  await expect(items).toHaveCount(2);
  await items.last().dblclick();
  await editor.press('Meta+a');
  await editor.press('Meta+c');
  await editor.press('ArrowRight');
  await editor.press('Meta+v');
  await editor.press('Meta+Enter');
  await expect(items).toHaveCount(2);
  await expect(items.last().locator('.item-text')).toHaveText(
    'OriginalOriginal'
  );
  await page.keyboard.press('Meta+v');
  await expect(items).toHaveCount(2);
});
