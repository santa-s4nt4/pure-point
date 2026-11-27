import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strToU8, zipSync } from 'fflate';
import { openFileWindow } from './document-window.js';

async function openShapes(page, shapes, assets = {}) {
  await page.goto('/');
  const { xml, media } = await page.evaluate(async ({ shapes, assets }) => {
    const { blankDeck, shape } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const deck = blankDeck();
    const object = (args) => {
      const item = shape('rect', ...args);
      if (item.items) item.items = item.items.map(object);
      return item;
    };
    deck.slides[0].items = shapes.map(object);
    return exportDeck(deck, null, assets);
  }, { shapes, assets });
  const bytes = zipSync(Object.fromEntries([
    ...Object.entries(xml).map(([name, value]) => [name, strToU8(value)]),
    ...Object.entries(media).map(([name, value]) => [name, Buffer.from(value, 'base64')]),
  ]));
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

test('Spacing with six selected shapes changes every gap along the dragged grid axis', async ({ page }) => {
  page = await openShapes(page, [90, 330].flatMap((y) =>
    [120, 330, 540].map((x) => [`${x}, ${y}`, x, y, 120, 65, { fill: '#354AE8' }])
  ));
  const art = page.locator('.artboard');
  const objects = art.locator('.scene > [data-id]');
  const scale = (await art.boundingBox()).width / 960;
  const positions = () => objects.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y } = node.getBoundingClientRect();
      return { x, y };
    })
  );
  const before = await positions();
  await objects.first().click();
  await page.keyboard.press('ControlOrMeta+a');
  const horizontal = art.locator('[data-spacing-handle=x]');
  const vertical = art.locator('[data-spacing-handle=y]');
  await expect(horizontal).toHaveCount(2);
  await expect(vertical).toHaveCount(1);
  const handle = await horizontal.last().boundingBox();
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40 * scale, y, { steps: 4 });
  const after = await positions();
  after.forEach(({ x, y }, i) => {
    expect(x - before[i].x).toBeCloseTo((i % 3) * 20 * scale, 0);
    expect(y).toBeCloseTo(before[i].y, 1);
  });
  await expect.poll(async () =>
    (await horizontal.allTextContents()).map((label) => Math.round(parseFloat(label.slice(1)) / 10))
  ).toEqual([22, 22]);
  await page.mouse.up();
  await expect(vertical).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await positions()).toEqual(before);
});

test('Selection edges resize one axis, corners resize both, and the interior moves', async ({ page }) => {
  page = await openShapes(page, [
    ['Frame', 180, 135, 210, 130, { fill: '#354AE8' }],
  ]);
  const board = page.locator('.artboard');
  const object = board.locator('.scene > [data-id]');
  await object.click();
  const before = await object.boundingBox();
  for (const [edge, dx, dy] of [
    ['n', 29, -21],
    ['s', 29, 21],
    ['w', -29, 21],
    ['e', 29, 21],
    ['se', 29, 21],
  ]) {
    const handle = await board.locator(`[data-handle="${edge}"]`).boundingBox();
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.keyboard.down('Alt');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const after = await object.boundingBox();
    const widthDelta = /[we]/.test(edge) ? 29 : 0;
    const heightDelta = /[ns]/.test(edge) ? 21 : 0;
    expect(after.width).toBeCloseTo(before.width + widthDelta, 0);
    expect(after.height).toBeCloseTo(before.height + heightDelta, 0);
    expect(after.x).toBeCloseTo(before.x - (edge === 'w' ? 29 : 0), 0);
    expect(after.y).toBeCloseTo(before.y - (edge === 'n' ? 21 : 0), 0);
    await page.keyboard.press('ControlOrMeta+z');
  }
  const x = before.x + before.width / 2, y = before.y + before.height / 2;
  await page.keyboard.down('Alt');
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 36, y + 28, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  const moved = await object.boundingBox();
  expect(moved.width).toBeCloseTo(before.width, 1);
  expect(moved.height).toBeCloseTo(before.height, 1);
  expect(moved.x).toBeCloseTo(before.x + 36, 0);
  expect(moved.y).toBeCloseTo(before.y + 28, 0);
});

test('A grouped image is selected by the first double-click and cropped by the next', async ({ page }) => {
  const asset = 'ppt/media/picture.png';
  const image = await readFile(new URL('./fixtures/image.png', import.meta.url));
  page = await openShapes(page, [
    ['Composition', 160, 100, 320, 220, {
      kind: 'group',
      childBox: [0, 0, 320, 220],
      items: [
        ['Shape', 15, 20, 115, 76, { fill: '#354AE8' }],
        ['Image', 170, 100, 145, 96, { kind: 'image', asset }],
      ],
    }],
  ], { [asset]: 'data:image/png;base64,' + image.toString('base64') });
  const board = page.locator('.artboard');
  const picture = board.locator('.group-content > .item:has(> .image-clip)');
  const designCrop = page.getByRole('button', { name: 'Crop image…' });
  const crop = board.getByRole('group', { name: 'Crop image' });
  await picture.click();
  await expect(designCrop).toHaveCount(0);
  await board.locator('.group-content > .item').first().dblclick();
  expect((await board.locator('.select-box').boundingBox()).width)
    .toBeLessThan((await picture.boundingBox()).width);
  await picture.dblclick();
  await expect(designCrop).toBeVisible();
  await expect(crop).toHaveCount(0);
  await picture.dblclick();
  await expect(crop).toBeVisible();
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
