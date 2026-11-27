import { openFileWindow } from './document-window.js';
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

test('Appearance follows the system and remembers an explicit override', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const appearance = page.getByRole('combobox', { name: 'Appearance' });
  const rail = page.locator('.rail');
  await expect(appearance).toHaveValue('system');
  await expect(rail).toHaveCSS('background-color', 'rgb(35, 37, 43)');
  const paper = page.locator('.artboard > .scene');
  const background = await paper.evaluate(
    (n) => getComputedStyle(n).backgroundColor
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(rail).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await appearance.selectOption('dark');
  await page.reload();
  await expect(appearance).toHaveValue('dark');
  await expect(rail).toHaveCSS('background-color', 'rgb(35, 37, 43)');
  await expect(paper).toHaveCSS('background-color', background);
  await appearance.selectOption('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(rail).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('#status')).toHaveText('Not saved yet');
});

test('Native New and Open leave edits in their window, and a new template title saves with 1.5 spacing', async ({
  page,
}) => {
  await page.goto('/');
  const parts = await page.evaluate(async () => {
    const { blankDeck } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const { layoutOptions } = await import('/src/slide-layouts.js');
    const d = blankDeck();
    d.slides = [layoutOptions(null, d, d.slides[0])[0].slide];
    const result = exportDeck(d);
    result.xml['ppt/slides/slide1.xml'] = result.xml[
      'ppt/slides/slide1.xml'
    ].replace('val="150000"', 'val="100000"');
    return { xml: result.xml, media: {} };
  });
  await page.addInitScript((parts) => {
    window.isTauri = true;
    window.requestedWindows = [];
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'document-1' } },
      transformCallback: () => 1,
      invoke: async (command, args) => {
        if (command === 'system_fonts') return [];
        if (command === 'open_template')
          return { id: 2, path: 'template.potx', parts };
        if (command === 'new_document_window')
          window.requestedWindows.push(args.pick);
        if (command === 'save_document') {
          window.savedChanges = args.changes;
          return '/tmp/test.pptx';
        }
      },
    };
  }, parts);
  await page.reload();
  const title = page.locator('.artboard .item[data-id]').first();
  await title.click();
  await expect(page.getByLabel('Line spacing', { exact: true })).toHaveValue(
    '1.5'
  );
  await page.getByRole('button', { name: 'Toggle script' }).click();
  await page
    .getByRole('textbox', { name: 'Slide script' })
    .fill('Keep this window');
  for (const command of ['new', 'open', 'save']) {
    await page.locator('.p-menu').click();
    await page.locator('.menu [data-action="' + command + '"]').click();
  }
  expect(await page.evaluate(() => window.requestedWindows)).toEqual([
    false,
    true,
  ]);
  await expect(page.getByRole('textbox', { name: 'Slide script' })).toHaveValue(
    'Keep this window'
  );
  expect(
    await page.evaluate(() => window.savedChanges.xml['ppt/slides/slide1.xml'])
  ).toContain('val="150000"');
});

test('New and Open create independent browser windows and preserve unsaved work', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle script' }).click();
  const notes = page.getByRole('textbox', { name: 'Slide script' });
  await notes.fill('Keep working here');
  const opened = page.context().waitForEvent('page');
  await page.keyboard.press('Meta+n');
  const fresh = await opened;
  const title = fresh.locator('.artboard .item[data-id]').first();
  await title.click();
  await expect(fresh.getByLabel('Line spacing', { exact: true })).toHaveValue(
    '1.5'
  );
  const saved = fresh.waitForEvent('download');
  await fresh.keyboard.press('Meta+Shift+s');
  const loaded = await openFileWindow(page, await (await saved).path());
  await expect(loaded.locator('.artboard .item[data-id]')).toHaveCount(1);
  await fresh.close();
  await loaded.close();
  await expect(notes).toHaveValue('Keep working here');
  await expect(page.locator('#status')).toHaveText('Unsaved changes');
});

test('Copied objects remain editable in another document window after the source closes', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const board = page.locator('.artboard');
  await page.locator('[data-action=tool-rect]').click();
  const b = await board.boundingBox();
  await page.mouse.move(b.x + 60, b.y + 60);
  await page.mouse.down();
  await page.mouse.move(b.x + 180, b.y + 160, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press('Meta+c');
  const opened = context.waitForEvent('page');
  await page.keyboard.press('Meta+n');
  const child = await opened;
  await expect(child.locator('#status')).toHaveText('Not saved yet');
  await page.close();
  await child.locator('.artboard').click({ position: { x: 40, y: 40 } });
  await child.keyboard.press('Meta+v');
  await expect(
    child.locator('.artboard .item[data-id] > .geometry')
  ).toHaveCount(1);
  await expect(child.getByLabel('Corner radius (%)')).toHaveValue('0');
});
