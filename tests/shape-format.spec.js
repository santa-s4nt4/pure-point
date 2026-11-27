import { openFileWindow } from './document-window.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

test('Callouts, rectangle corners and text decorations remain editable after a PowerPoint round trip', async ({
  page,
}, info) => {
  await page.goto('/');
  const art = page.locator('.artboard');
  const objects = art.locator(':scope > .scene > [data-id]');
  const box = await art.boundingBox();
  async function draw(tool, x, y) {
    await page.locator('[data-action="tool-' + tool + '"]').click();
    const scaled = box.width / 960;
    await page.mouse.move(box.x + x * scaled, box.y + y * scaled);
    await page.mouse.down();
    await page.mouse.move(
      box.x + (x + 270) * scaled,
      box.y + (y + 140) * scaled,
      { steps: 4 }
    );
    await page.mouse.up();
  }
  async function download(name) {
    const ready = page.waitForEvent('download');
    await page.keyboard.press('ControlOrMeta+Shift+s');
    const path = info.outputPath(name);
    await (await ready).saveAs(path);
    return path;
  }

  await draw('rect', 60, 120);
  const radius = page.getByLabel('Corner radius (%)');
  await expect(radius).toHaveValue('0');
  await radius.fill('28');
  await radius.press('Enter');
  await expect(objects.first().locator('svg path').first()).toHaveAttribute(
    'd',
    /C/
  );

  await draw('callout', 450, 120);
  const callout = objects.last();
  const variant = page.getByLabel('Callout shape');
  await expect(variant).toHaveValue('ellipse');
  const oval = await callout.locator('.geometry path').getAttribute('d');
  await variant.selectOption('rect');
  await expect(callout.locator('.geometry path')).not.toHaveAttribute('d', /C/);
  await radius.fill('24');
  await radius.press('Enter');
  await expect(callout.locator('.geometry path')).not.toHaveAttribute(
    'd',
    oval
  );

  await callout.dblclick();
  const edit = page.getByRole('textbox', { name: 'Slide text' });
  await edit.fill('ふきだし');
  const underline = page.getByRole('button', {
    name: 'Underline',
    exact: true,
  });
  const strike = page.getByRole('button', {
    name: 'Strikethrough',
    exact: true,
  });
  await underline.click();
  await strike.click();
  await expect(edit).toBeFocused();
  await expect(edit).toHaveCSS(
    'text-decoration-line',
    'underline line-through'
  );
  await edit.press('ControlOrMeta+Enter');

  await callout.dblclick();
  await expect(edit).toBeFocused();
  const tip = page.locator('.artboard .callout-tip');
  const initialTip = await tip.boundingBox();
  const center = {
    x: initialTip.x + initialTip.width / 2,
    y: initialTip.y + initialTip.height / 2,
  };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 42, center.y + 16, { steps: 4 });
  await page.mouse.up();
  expect((await tip.boundingBox()).x - initialTip.x).toBeCloseTo(42, 0);

  const first = await download('callout.pptx');
  page = await openFileWindow(page, first);
  const reopenedObjects = page.locator('.artboard .scene > [data-id]');
  const reopenedRadius = page.getByLabel('Corner radius (%)');
  await expect(reopenedObjects).toHaveCount(2);
  await reopenedObjects.first().click();
  await expect(reopenedRadius).toHaveValue('28');
  await reopenedObjects.last().click();
  await expect(page.getByLabel('Callout shape')).toHaveValue('rect');
  await expect(reopenedRadius).toHaveValue('24');
  expect(
    (await page.locator('.callout-tip').boundingBox()).x - initialTip.x
  ).toBeCloseTo(42, 0);
  await expect(
    reopenedObjects.last().locator('.item-text span').first()
  ).toHaveCSS('text-decoration-line', 'underline line-through');
  const reopenedStrike = page.getByRole('button', {
    name: 'Strikethrough',
    exact: true,
  });
  await reopenedStrike.click();
  await expect(
    page.getByRole('button', { name: 'Underline', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(reopenedStrike).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('Callout shape').selectOption('ellipse');
  await reopenedObjects.first().click();
  await reopenedRadius.fill('0');
  await reopenedRadius.press('Enter');
  const second = await download('edited.pptx');
  const xml = strFromU8(
    unzipSync(await readFile(second))['ppt/slides/slide1.xml']
  );
  expect(xml).toContain('prst="wedgeEllipseCallout"');
  expect(xml).toContain('prst="rect"');
  expect(xml).not.toContain('prst="roundRect"');
  expect(xml).toContain('strike="noStrike"');
  expect(xml).toContain('u="sng"');
});
