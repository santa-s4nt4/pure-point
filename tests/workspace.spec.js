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
  await expect(page.getByLabel('Slide size')).toHaveValue('0');
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
  await entry.press('ControlOrMeta+Enter');
  await expect(art.locator('.item-text')).toHaveText('Double-click to write');
  await art.locator('.item-text').dblclick({ force: true });
  await expect(entry).toBeVisible();
});

test('A fitted canvas pans diagonally and reveals overflowing objects', async ({ page }) => {
  await page.goto('/');
  const xml = await page.evaluate(async () => {
    const { blankDeck, shape, textItem } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const deck = blankDeck();
    deck.slides[0].items.push(
      shape('rect', 'Crosses right edge', 900, 140, 90, 70, { fill: '#354AE8' }),
      textItem('Outside the slide', -30, 60, 100, 25, 12, { noWrap: true })
    );
    return exportDeck(deck).xml;
  });
  page = await openFileWindow(page, {
    name: 'overflow.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(zipSync(Object.fromEntries(
      Object.entries(xml).map(([k, v]) => [k, strToU8(v)])
    ))),
  });
  const board = page.locator('.artboard');
  const before = await board.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.wheel(120, -85);
  await expect.poll(async () => (await board.boundingBox()).x).toBeLessThan(before.x - 50);
  await expect.poll(async () => (await board.boundingBox()).y).toBeGreaterThan(before.y + 50);
  expect((await board.boundingBox()).width).toBeCloseTo(before.width);
  await page.locator('footer [data-action=fit]').click();
  const fitted = await board.boundingBox();
  expect(fitted.x).toBeCloseTo(before.x);
  expect(fitted.y).toBeCloseTo(before.y);
  expect(await board.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return [...node.querySelectorAll('.scene > [data-id]')].map((item) => {
      const box = item.getBoundingClientRect();
      const x = box.x < bounds.left ? box.x + 5 : box.right - 5;
      return document.elementFromPoint(x, box.y + box.height / 2)?.closest('[data-id]') === item;
    });
  })).toEqual([true, true]);
  await expect(page.locator('.thumbs .scene').first()).toHaveCSS('overflow', 'hidden');
});

test('Portrait layouts and deck-wide contrasting page numbers survive save and reopen', async ({ page }, info) => {
  await page.goto('/');
  const xml = await page.evaluate(async () => {
    const { blankDeck, shape } = await import('/src/model.js');
    const { layoutOptions } = await import('/src/slide-layouts.js');
    const { exportDeck } = await import('/src/export.js');
    const { desc, parse, serialize } = await import('/src/xml.js');
    const deck = blankDeck();
    deck.slides = [layoutOptions(null, deck, deck.slides[0])[0].slide];
    deck.slides[0].items.push(
      shape('ellipse', 'Master decoration', 890, 470, 50, 50, { fill: '#354AE8' })
    );
    const { xml } = exportDeck(deck);
    const slidePath = 'ppt/slides/slide1.xml',
      masterPath = 'ppt/slideMasters/slideMaster1.xml';
    const slide = parse(xml[slidePath]), master = parse(xml[masterPath]);
    desc(master, 'spTree').append(desc(slide, 'spTree').lastElementChild);
    xml[slidePath] = serialize(slide);
    xml[masterPath] = serialize(master);
    return xml;
  });
  page = await openFileWindow(page, {
    name: 'master-layout.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(zipSync(Object.fromEntries(
      Object.entries(xml).map(([part, value]) => [part, strToU8(value)])
    ))),
  });
  const size = page.getByLabel('Slide size');
  const numberButton = page.getByRole('button', { name: 'Show page numbers' });
  const pageNumber = page.locator('.artboard .slide-page-number');
  const title = page.locator('.artboard .empty-placeholder').first();
  const decoration = page.locator('.artboard .scene > .item:not([data-id], .slide-page-number)');
  const top = () => title.evaluate((node) => parseFloat(node.style.top));
  const landscapeTop = await top();
  const numberFormat = () => pageNumber.evaluate((node) => {
    const text = node.querySelector('.item-text');
    return {
      x: 2 * (parseFloat(node.style.left) + parseFloat(node.style.width)),
      y: 2 * parseFloat(node.style.top),
      size: text.style.fontSize,
      align: text.style.textAlign,
      font: text.style.fontFamily,
    };
  });
  await numberButton.click();
  await expect(pageNumber).toHaveText('1');
  await expect(pageNumber.locator('.item-text')).toHaveCSS('color', 'rgb(0, 0, 0)');
  expect(await numberFormat()).toMatchObject({ x: 1895, y: 1040, size: '12px', align: 'right', font: expect.stringContaining('Yu Gothic') });
  await size.selectOption({ label: '1350 × 1950 px' });
  const portraitTop = await top();
  expect(portraitTop / 975).toBeCloseTo(landscapeTop / 540, 5);
  const decorationFrame = () => decoration.evaluate((node) =>
    ['left', 'top', 'width', 'height'].map((key) => parseFloat(node.style[key]))
  );
  const portraitFrame = await decorationFrame();
  expect(portraitFrame[2]).toBeCloseTo(portraitFrame[3]);
  expect(portraitFrame[1] + portraitFrame[3]).toBeGreaterThan(900);
  expect(await numberFormat()).toMatchObject({ x: 1325, y: 1910 });
  const rail = page.locator('.rail');
  for (let i = 0; i < 3; i++) {
    await rail.getByRole('button', { name: 'Add slide', exact: true }).click();
    await page.getByRole('button', { name: 'title', exact: true }).click();
    await expect(size).toHaveValue('1');
    expect(await top()).toBeCloseTo(portraitTop, 3);
    await expect(numberButton).toHaveAttribute('aria-pressed', 'true');
    await expect(pageNumber).toHaveText(String(i + 2));
    if (i === 0) {
      await page.locator('[data-color=bg]').click();
      await page.getByLabel('Hex color').fill('162035');
      await expect(pageNumber.locator('.item-text')).toHaveCSS('color', 'rgb(255, 255, 255)');
      await page.keyboard.press('Escape');
    }
  }
  await rail.locator('[data-hide-slide="2"]').click({ force: true });
  await expect(pageNumber).toHaveText('3');
  const output = info.outputPath('portrait.pptx');
  page = await saveAndReopen(page, output);
  await expect(page.getByLabel('Slide size')).toHaveValue('1');
  const numbers = page.locator('.artboard .slide-page-number');
  const restoredFrame = await page.locator('.artboard .scene > .item').first().evaluate((node) =>
    ['left', 'top', 'width', 'height'].map((key) => parseFloat(node.style[key]))
  );
  restoredFrame.forEach((value, index) => expect(value).toBeCloseTo(portraitFrame[index], 3));
  for (const [index, value] of ['1', '2', '', '3'].entries()) {
    await page.locator(`.rail [data-slide="${index}"]`).click();
    if (value) await expect(numbers).toHaveText(value);
    else await expect(numbers).toHaveCount(0);
  }
  await page.locator('.rail [data-hide-slide="2"]').click({ force: true });
  await expect(numbers).toHaveText('4');
  const parts = unzipSync(await readFile(output));
  const presentation = strFromU8(parts['ppt/presentation.xml']);
  expect(presentation).toContain('<p:sldSz cx="8572500" cy="12382500"');
  const fourth = strFromU8(parts['ppt/slides/slide4.xml']);
  expect(fourth).toContain('<a:t>3</a:t>');
  expect(fourth).toContain('<a:off x="7651750" y="12128500"');
  expect(fourth).toContain('<a:latin typeface="Yu Gothic"');
  expect(fourth).toContain('sz="1200"');
  expect(fourth).not.toContain('NaN');
  expect(strFromU8(parts['ppt/slides/slide3.xml'])).not.toContain('pure-point page number');
  expect(strFromU8(parts['ppt/slides/slide2.xml'])).toContain('<a:srgbClr val="FFFFFF"');
  const savedXml = Object.fromEntries(Object.entries(parts).map(([part, data]) => [part, strFromU8(data)]));
  const pdf = await page.evaluate(async (xml) => {
    const { importDeck } = await import('/src/import.js');
    const { pdfDocument } = await import('/src/document.js');
    const { deck } = importDeck({ xml, media: {} });
    const { html, width, height, count } = await pdfDocument(deck, {});
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return { width, height, count, labels: [...doc.querySelectorAll('.slide-page-number')].map((n) => n.textContent) };
  }, savedXml);
  expect(pdf).toEqual({ width: 675, height: 975, count: 3, labels: ['1', '2', '3'] });
  const renumbered = info.outputPath('renumbered.pptx');
  await saveAndReopen(page, renumbered);
  const updated = unzipSync(await readFile(renumbered));
  expect(strFromU8(updated['ppt/slides/slide4.xml'])).toContain('<a:t>4</a:t>');
});

test('Delete removes a selected comment from its card or pin and supports undo', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-action=comments]').click();
  const input = page.getByRole('textbox', { name: 'Comment', exact: true });
  await input.fill('Review this point');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  const card = page.locator('.comment-card');
  const pin = page.locator('.comment-pin');
  await card.getByText('Review this point').click();
  await expect(card).toHaveClass(/focused/);
  await page.keyboard.press('Delete');
  await expect(card).toHaveCount(0);
  await expect(pin).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(card).toHaveCount(1);
  await pin.click();
  await expect(pin).toBeFocused();
  await page.keyboard.press('Backspace');
  await expect(card).toHaveCount(0);
  await expect(page.locator('#slide-counter')).toHaveText('Slide 1 / 1');
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
  await page.keyboard.press('ControlOrMeta+Enter');
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
  await page.keyboard.press('ControlOrMeta+z');
  expect(Number(await x.inputValue())).toBeCloseTo(first + 1, 2);
});
