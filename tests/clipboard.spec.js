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
  await expect(items).toHaveCount(3);
  await expect(items.last().locator('.item-text')).toHaveText('Original');
});

test('System text and screenshots paste as editable, undoable slide objects and survive saving', async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const board = page.locator('.artboard');
  const text = board.locator('.item-text');
  const image = board.locator('.image-clip img');
  const lines = '発表のメモ 🎤\nSecond line · résumé';
  await board.click({ position: { x: 60, y: 50 } });
  await page.evaluate((s) => navigator.clipboard.writeText(s), lines);
  await page.keyboard.press('Meta+v');
  await expect(text).toBeVisible();
  expect(await text.innerText()).toBe(lines);
  await expect(page.getByLabel('Font family', { exact: true })).toHaveValue(
    'Yu Gothic'
  );
  await expect(page.getByLabel('Size (pt)', { exact: true })).toHaveValue('24');
  await expect(board.locator('.select-box')).toHaveCount(1);
  await page.keyboard.press('Meta+z');
  await expect(text).toHaveCount(0);
  await page.keyboard.press('Meta+Shift+z');
  await expect(text).toHaveText(lines, { useInnerText: true });

  // An external screenshot replaces a previously copied pure-point object.
  await board.locator('.item[data-id]').click();
  await page.keyboard.press('Meta+c');
  const png = await page.screenshot({
    clip: { x: 10, y: 50, width: 85, height: 40 },
  });
  await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }, png.toString('base64'));
  await page.keyboard.press('Meta+v');
  await expect(image).toBeVisible();
  await expect(text).toHaveCount(1);
  await expect(board.locator('.select-box')).toHaveCount(1);
  await expect
    .poll(() => image.evaluate((n) => [n.naturalWidth, n.naturalHeight]))
    .toEqual([85, 40]);
  const imageData = await image.getAttribute('src');
  expect(imageData).toMatch(/^data:image\/png;base64,/);
  await page.keyboard.press('Meta+z');
  await expect(image).toHaveCount(0);
  await expect(text).toHaveCount(1);
  await page.keyboard.press('Meta+Shift+z');
  await expect(image).toBeVisible();

  const output = info.outputPath('clipboard.pptx');
  const saved = page.waitForEvent('download');
  await page.keyboard.press('Meta+Shift+s');
  await (await saved).saveAs(output);
  const opened = page.waitForEvent('filechooser');
  await page.keyboard.press('Meta+o');
  await (await opened).setFiles(output);
  await expect(page.locator('.doc-name')).toHaveText('clipboard.pptx');
  await expect(text).toHaveText(lines, { useInnerText: true });
  await expect(image).toHaveAttribute('src', imageData);
});

test('Canvas Paste reads the current system clipboard before the first object copy', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.evaluate(() =>
    navigator.clipboard.writeText('An external caption')
  );
  const board = page.locator('.artboard');
  await board.click({ button: 'right', position: { x: 120, y: 55 } });
  const paste = page.getByRole('menuitem', { name: /^Paste/ });
  await expect(paste).toBeVisible();
  await paste.click();
  await expect(board.locator('.item-text')).toHaveText('An external caption');
});
