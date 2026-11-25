import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

test('The titlebar controls the workspace and keeps the document menu accessible', async ({
  page,
}) => {
  await page.goto('/');
  const header = page.locator('header');
  const stage = page.locator('.stage');
  const navigator = header.getByRole('button', {
    name: 'Toggle slide navigator',
  });
  const inspector = header.getByRole('button', { name: 'Toggle inspector' });
  const script = header.getByRole('button', { name: 'Toggle script' });
  const field = page.getByRole('textbox', { name: 'Slide script' });
  const menu = header.getByRole('button', { name: 'Document menu' });
  const filename = menu.locator('.doc-name');
  const logo = menu.locator('#floating-p');
  await expect(filename).toHaveText('untitled.pptx');
  await expect(header.locator('#status')).toHaveText('Not saved yet');
  await expect(header).toHaveAttribute('data-tauri-drag-region', 'deep');
  const barBox = await header.boundingBox();
  const titleBox = await header.locator('.document-name').boundingBox();
  const logoBox = await logo.boundingBox();
  expect(titleBox.x + titleBox.width / 2).toBeCloseTo(
    barBox.x + barBox.width / 2,
    0
  );
  expect(logoBox.x + logoBox.width).toBeLessThanOrEqual(
    (await filename.boundingBox()).x
  );
  await expect(
    header.locator('[data-action=copyShareLink] + .panel-toggles')
  ).toBeVisible();
  await expect(header.locator('[data-action=copyShareLink]')).toBeHidden();
  await expect(field).toBeHidden();
  const before = await stage.boundingBox();
  await navigator.click();
  await inspector.click();
  await expect(page.locator('.rail')).toBeHidden();
  await expect(page.locator('.rail-resizer')).toBeHidden();
  await expect(page.locator('.inspector')).toBeHidden();
  await expect(navigator).toHaveAttribute('aria-pressed', 'false');
  expect((await stage.boundingBox()).width).toBeGreaterThan(before.width + 200);
  await filename.click();
  await expect(page.locator('.menu [data-action=open]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await logo.click();
  await expect(page.locator('.menu [data-action=saveAs]')).toBeVisible();
  await page.keyboard.press('Escape');
  await inspector.click();
  await navigator.click();
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.locator('.rail')).toBeVisible();
  await script.click();
  await expect(field).toBeFocused();
  expect((await stage.boundingBox()).height).toBeLessThan(before.height - 40);
  await field.fill('Opening remarks');
  await expect(header.locator('#status')).toHaveText('Unsaved changes');
  await script.click();
  await expect(field).toBeHidden();
  expect((await stage.boundingBox()).height).toBeCloseTo(before.height, 1);
  await script.click();
  await expect(field).toHaveValue('Opening remarks');
  await page.locator('.rail [data-action=addSlide]').click();
  await page.locator('dialog [data-layout]').first().click();
  await expect(field).toHaveValue('');
  await field.fill('Closing remarks');
  await page.locator('.rail .select-slide').first().click();
  await expect(field).toHaveValue('Opening remarks');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Meta+s');
  await download;
  await expect(header.locator('#status')).toHaveText('Saved');
  await field.fill('Updated opening');
  await expect(header.locator('#status')).toHaveText('Unsaved changes');
});

test('Edits made while the ZIP is writing remain unsaved and undo to the saved revision', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle script' }).click();
  const field = page.getByRole('textbox', { name: 'Slide script' });
  await field.fill('First version');

  // Delay the browser's on-demand ZIP writer, keeping the real save operation in flight.
  let releaseWriter;
  const writer = new Promise((resolve) => {
    releaseWriter = resolve;
  });
  let startWriting;
  const writing = new Promise((resolve) => {
    startWriting = resolve;
  });
  await page.route(/\/fflate(?:\.js|\/)/, async (route) => {
    startWriting();
    await writer;
    await route.continue();
  });
  const downloaded = page.waitForEvent('download');
  await field.press('Meta+s');
  try {
    await writing;
    await expect(page.locator('header #status')).toHaveText('Working…');
    await field.fill('Second version');
  } finally {
    releaseWriter();
  }
  const archive = unzipSync(await readFile(await (await downloaded).path()));
  const notes = Object.entries(archive)
    .filter(([path]) => /\/notesSlides\/[^/]+\.xml$/.test(path))
    .map(([, bytes]) => strFromU8(bytes))
    .join('');
  expect(notes).toContain('First version');
  expect(notes).not.toContain('Second version');
  await expect(page.locator('header #status')).toHaveText('Unsaved changes');
  await expect(field).toHaveValue('Second version');
  await field.blur();
  await page.keyboard.press('Meta+z');
  await expect(field).toHaveValue('First version');
  await expect(page.locator('header #status')).toHaveText('Saved');
});
