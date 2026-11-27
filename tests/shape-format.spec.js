import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

test('Callouts, rectangle corners and text decorations remain editable after a PowerPoint round trip', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.locator('[data-action="fileMenu"]').click();
  await page.locator('.menu [data-action="new"]').click();
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
    await page.keyboard.press('Meta+Shift+s');
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
  await variant.selectOption('roundRect');
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
  await edit.press('Meta+Enter');

  const first = await download('callout.pptx');
  const picker = page.waitForEvent('filechooser');
  await page.keyboard.press('Meta+o');
  await (await picker).setFiles(first);
  await expect(objects).toHaveCount(2);
  await objects.first().click();
  await expect(radius).toHaveValue('28');
  await callout.click();
  await expect(variant).toHaveValue('roundRect');
  await expect(callout.locator('.item-text span').first()).toHaveCSS(
    'text-decoration-line',
    'underline line-through'
  );
  await strike.click();
  await expect(underline).toHaveAttribute('aria-pressed', 'true');
  await expect(strike).toHaveAttribute('aria-pressed', 'false');
  await variant.selectOption('ellipse');
  await objects.first().click();
  await radius.fill('0');
  await radius.press('Enter');
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
