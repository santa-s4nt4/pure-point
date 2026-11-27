import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { openFileWindow } from './document-window.js';

async function openShapes(page, shapes) {
  await page.goto('/');
  const xml = await page.evaluate(async (shapes) => {
    const { blankDeck, shape } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const deck = blankDeck();
    deck.slides[0].items = shapes.map((args) => shape('rect', ...args));
    return exportDeck(deck).xml;
  }, shapes);
  const bytes = zipSync(Object.fromEntries(
    Object.entries(xml).map(([name, value]) => [name, strToU8(value)])
  ));
  return openFileWindow(page, {
    name: 'arrange.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(bytes),
  });
}

test('Two-object spacing can be dragged along either axis and undone', async ({ page }) => {
  page = await openShapes(page, [
    ['Anchor', 120, 95, 140, 70, { fill: '#008166' }],
    ['Below', 125, 225, 120, 75, { fill: '#354AE8' }],
    ['Right', 400, 100, 110, 65, { fill: '#B6305C' }],
  ]);
  const art = page.locator('.artboard');
  const objects = art.locator('.scene > [data-id]');
  const scale = (await art.boundingBox()).width / 960;
  for (const [axis, index, gap] of [['y', 1, 120], ['x', 2, 280]]) {
    await objects.first().click();
    await objects.nth(index).click({ modifiers: ['Shift'] });
    const handle = art.locator(`[data-spacing-handle="${axis}"]`);
    await expect(handle).toContainText(`${gap} px`);
    const start = await handle.boundingBox();
    const x = start.x + start.width / 2, y = start.y + start.height / 2;
    const anchored = await objects.first().boundingBox();
    const moving = await objects.nth(index).boundingBox();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (axis === 'x' ? 40 * scale : 0), y + (axis === 'y' ? 40 * scale : 0), { steps: 4 });
    expect(parseFloat((await handle.textContent()).slice(1))).toBeCloseTo(gap + 80, -1);
    await page.mouse.up();
    expect((await objects.first().boundingBox())[axis]).toBeCloseTo(anchored[axis], 1);
    expect((await objects.nth(index).boundingBox())[axis] - moving[axis]).toBeCloseTo(40 * scale, 0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(handle).toContainText(`${gap} px`);
    await handle.focus();
    await handle.press(axis === 'x' ? 'ArrowRight' : 'ArrowDown');
    await expect(handle).toContainText(`${gap + 1} px`);
    await handle.blur();
  }
});

test('Smart movement guides connect matching edges and centers on rotated objects', async ({ page }) => {
  page = await openShapes(page, [
    ['Move', 120, 120, 76, 48, { fill: '#008166' }],
    ['Target', 450, 280, 116, 82, { fill: '#354AE8', rotation: 32 }],
  ]);
  const art = page.locator('.artboard');
  const objects = art.locator('.scene > [data-id]');
  const moving = await objects.first().boundingBox();
  const target = await objects.last().boundingBox();
  const x = moving.x + moving.width / 2, y = moving.y + moving.height / 2;
  const rightEdge = target.x + target.width;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(rightEdge - 2, y, { steps: 6 });
  const guide = art.locator('.object-guide.v');
  await expect(guide).toBeVisible();
  const bounds = await guide.boundingBox();
  expect(bounds.x).toBeCloseTo(rightEdge, 0);
  expect(bounds.y).toBeLessThan(moving.y);
  expect(bounds.y + bounds.height).toBeGreaterThan(target.y + target.height);
  expect(bounds.height).toBeLessThan((await art.boundingBox()).height);
  const verticalCenter = target.y + target.height / 2;
  await page.mouse.move(rightEdge - 2, verticalCenter - 2, { steps: 4 });
  const horizontalGuide = art.locator('.object-guide.h');
  await expect(horizontalGuide).toBeVisible();
  expect((await horizontalGuide.boundingBox()).y).toBeCloseTo(verticalCenter, 0);
  await page.mouse.up();
  await expect(guide).toHaveCount(0);
  const moved = await objects.first().boundingBox();
  expect(moved.x + moved.width / 2).toBeCloseTo(rightEdge, 0);
  expect(moved.y + moved.height / 2).toBeCloseTo(verticalCenter, 0);
});
