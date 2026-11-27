import { openFileWindow } from './document-window.js';
import { test, expect } from '@playwright/test';
import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate';
import { readFile } from 'node:fs/promises';

async function saveAndReopen(page, path) {
  await page.locator('.p-menu').click();
  const ready = page.waitForEvent('download');
  await page.locator('[data-action=saveAs]').click();
  await (await ready).saveAs(path);
  return openFileWindow(page, path);
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
      .getByRole('button', { name: 'header title', exact: true })
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
  await page.locator('header [data-action=inspector]').click();
  await expect(page.locator('.inspector')).toBeHidden();
  await page.locator('header [data-action=inspector]').click();
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
  page = await saveAndReopen(page, output);
  const reopenedRail = page.locator('.rail');
  await expect(reopenedRail.locator('.slide-hidden')).toHaveCount(1);
  await expect(reopenedRail.getByText('Process')).toBeVisible();
  await reopenedRail.locator('[data-slide="3"]').click();
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

test('Dragging navigator slides uses a bounded preview of the moving selection', async ({
  page,
}) => {
  await page.goto('/');
  const slides = page.locator('.rail [data-slide]');
  for (let i = 0; i < 2; i++) {
    await page.locator('.rail [data-action=addSlide]').click();
    await page.locator('dialog [data-layout]').first().click();
  }
  await slides.nth(0).click();
  await slides.nth(1).click({ modifiers: ['Shift'] });
  const previews = await slides.evaluateAll((tiles) =>
    tiles.map((tile) => {
      const data = new DataTransfer();
      let preview;
      data.setDragImage = (element) => {
        preview = {
          cards: element.querySelectorAll('.drag-card > .scene').length,
          count: element.querySelector('.drag-count')?.textContent,
          width: element.getBoundingClientRect().width,
        };
      };
      tile.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, dataTransfer: data })
      );
      return preview;
    })
  );
  expect(previews.map((p) => p.cards)).toEqual([2, 2, 1]);
  expect(previews[0].count).toBe('2');
  expect(previews[0].width).toBeLessThanOrEqual(165);
  await expect(page.locator('.slide-drag-preview')).toHaveCount(0);
});

test('Grid rows reach both margins and navigation preserves up-to-date previews', async ({
  page,
}) => {
  await page.goto('/');
  const xml = await page.evaluate(async () => {
    const { blankDeck, slide } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const deck = blankDeck();
    deck.slides = Array.from({ length: 32 }, () => slide());
    return exportDeck(deck).xml;
  });
  const bytes = zipSync(
    Object.fromEntries(Object.entries(xml).map(([k, v]) => [k, strToU8(v)]))
  );
  page = await openFileWindow(page, {
    name: 'slides.pptx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator('.rail .slide-tile')).toHaveCount(32);
  const reference = await page
    .locator('.thumbs [data-slide="2"] .scene')
    .elementHandle();
  await page.locator('.artboard').dblclick({ position: { x: 50, y: 50 } });
  await page.getByRole('textbox', { name: 'Slide text' }).fill('Updated');
  await page.locator('.thumbs [data-slide="1"]').click();
  const edited = page.locator('.thumbs [data-slide="0"] .item-text');
  await expect(edited).toHaveText('Updated');
  expect(await reference.evaluate((node) => node.isConnected)).toBe(true);
  await page.locator('.thumbs [data-slide="31"]').scrollIntoViewIfNeeded();
  await expect(page.locator('.thumbs [data-slide="31"] .scene')).toHaveCount(1);
  await expect(edited).toHaveCount(0);
  await page.locator('.thumbs [data-slide="0"]').scrollIntoViewIfNeeded();
  await expect(edited).toHaveText('Updated');
  await page.locator('.thumbs [data-slide="0"]').click();
  await page.locator('.artboard .item[data-id]').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.artboard .item-text')).toHaveCount(0);
  await expect(page.locator('.rail .slide-tile')).toHaveCount(32);

  await page.locator('.rail [data-action=overview]').click();
  for (const width of [830, 1536]) {
    await page.setViewportSize({ width, height: 820 });
    for (const zoom of ['0.25', '0.5', '1', '1.5', '2', '3', '4', '6']) {
      await page.locator('#zoom').selectOption(zoom);
      const margins = await page.locator('.sorter').evaluate((host) => {
        const frames = [...host.querySelectorAll('.thumb-frame')].map(
          (n) => n.getBoundingClientRect()
        );
        const row = frames.filter((r) => r.top === frames[0].top);
        const left = host.getBoundingClientRect().left + host.clientLeft;
        return [row[0].left - left, left + host.clientWidth - row.at(-1).right];
      });
      expect(margins[0]).toBeGreaterThan(0);
      expect(Math.abs(margins[0] - margins[1])).toBeLessThan(1);
    }
  }
  await page.locator('#zoom').selectOption('1');
  const host = page.locator('.sorter');
  const card = host.locator('[data-slide="16"]');
  await card.evaluate((n) => n.scrollIntoView({ block: 'center' }));
  const start = await card.boundingBox();
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  const columns = () =>
    host
      .locator('.sorter-grid')
      .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
  const initialColumns = await columns();
  let totalDelta = 0;
  for (const deltaY of [-1, -1, 1, 1]) {
    await host.dispatchEvent('wheel', {
      deltaY,
      ctrlKey: true,
      clientX: x,
      clientY: y,
    });
    totalDelta += deltaY;
    const current = await card.boundingBox();
    expect(await columns()).toBe(initialColumns);
    const expectedWidth = start.width * Math.exp(-0.012 * totalDelta);
    expect(Math.abs(current.width - expectedWidth)).toBeLessThan(0.1);
    expect(Math.abs(current.y + current.height / 2 - y)).toBeLessThan(1);
  }
});

test('Column boundaries paint at 4K across fit and fractional zoom', async ({
  browser,
}) => {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({
      viewport: { width: 3840 / dpr, height: 2160 / dpr },
      deviceScaleFactor: dpr,
    });
    try {
      await page.goto('http://127.0.0.1:1420');
      await page.locator('[data-preset=columns]').click();
      for (const zoom of ['fit', '0.75']) {
        await page.locator('#zoom').selectOption(zoom);
        const art = page.locator('.artboard');
        const row = await art.evaluate((n) => {
          const rect = n.getBoundingClientRect();
          const columns = [...n.querySelectorAll('.grid-overlay rect')];
          const x = columns.flatMap((col) => {
            const r = col.getBoundingClientRect();
            return [r.left, r.right];
          });
          return { x, y: Math.round(rect.y + rect.height / 2) };
        });
        const shot = await page.screenshot({
          clip: { x: 0, y: row.y, width: 3840 / dpr, height: 1 },
        });
        const visible = await page.evaluate(
          async ({ image, x, dpr }) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + image;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const c = canvas.getContext('2d');
            c.drawImage(img, 0, 0);
            return x
              .filter(
                (pos) =>
                  pos > 0 &&
                  pos < innerWidth &&
                  document
                    .elementFromPoint(pos, innerHeight / 2)
                    ?.closest('.artboard')
              )
              .map((pos) => {
                const rgb = c.getImageData(
                  Math.round(pos * dpr) - 2,
                  0,
                  5,
                  1
                ).data;
                return [0, 4, 8, 12, 16].some((i) => rgb[i + 2] - rgb[i] > 45);
              });
          },
          { image: shot.toString('base64'), x: row.x, dpr }
        );
        expect(visible.length).toBeGreaterThan(12);
        expect(visible.every(Boolean)).toBe(true);
      }
    } finally {
      await page.close();
    }
  }
});

test('Design number fields support repeated arrows and one undo per drag', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('.artboard').dblclick({ position: { x: 120, y: 130 } });
  await page.keyboard.insertText('Position');
  await page.keyboard.press('Meta+Enter');
  const x = page.getByLabel('X (px)', { exact: true });
  const first = Number(await x.inputValue());
  await x.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await expect(x).toBeFocused();
  expect(Number(await x.inputValue())).toBeCloseTo(first + 1, 2);
  const b = await x.boundingBox();
  const sx = b.x + b.width / 2,
    sy = b.y + b.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 36, sy, { steps: 6 });
  expect(Number(await x.inputValue())).toBeCloseTo(first + 13, 2);
  await page.mouse.up();
  await x.blur();
  await page.keyboard.press('Meta+z');
  expect(Number(await x.inputValue())).toBeCloseTo(first + 1, 2);
});
