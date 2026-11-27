import { openFileWindow } from './document-window.js';
import { test, expect } from '@playwright/test';

test('Text edits use the existing glyphs, stay editable through spacing changes, and release selection outside', async ({
  page,
}) => {
  await page.goto('/');
  const board = page.locator('.artboard'),
    input = page.getByRole('textbox', { name: 'Slide text' });
  await board.dblclick({ position: { x: 110, y: 115 } });
  await expect(input).toBeFocused();
  await expect(page.getByLabel('Size (pt)', { exact: true })).toHaveValue('16');
  await expect(page.getByLabel('Font family', { exact: true })).toHaveValue(
    'Yu Gothic'
  );
  await page.keyboard.insertText('Camera');
  const initial = await input.boundingBox();
  await page.keyboard.insertText(' lens');
  expect((await input.boundingBox()).width).toBeGreaterThan(initial.width);
  for (let i = 0; i < 5; i++) await input.press('Backspace');
  expect((await input.boundingBox()).width).toBeCloseTo(initial.width, 1);
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('geometry');
  expect((await input.boundingBox()).height).toBeGreaterThan(
    initial.height * 1.8
  );
  await input.press('Meta+Enter');
  const body = board.locator('.item-text');
  await expect(body).toHaveText('Camera\ngeometry');
  const bounds = await body.boundingBox();
  await body.dblclick({
    position: { x: bounds.width * 0.33, y: bounds.height * 0.23 },
    force: true,
  });
  await expect(input).toBeFocused();
  const after = await input.boundingBox();
  expect(
    Math.abs(bounds.x - after.x) + Math.abs(bounds.y - after.y)
  ).toBeLessThan(0.2);
  expect(await input.evaluate((n) => getComputedStyle(n).backgroundColor)).toBe(
    'rgba(0, 0, 0, 0)'
  );
  expect(
    await input.evaluate((n) => {
      const s = getSelection();
      return (
        n.contains(s.anchorNode) &&
        s.anchorOffset > 0 &&
        s.anchorOffset < 6 &&
        s.isCollapsed
      );
    })
  ).toBe(true);
  const tracking = page.getByLabel('Letter spacing (pt)');
  await tracking.fill('2.5');
  await tracking.press('Enter');
  await expect(input).toBeFocused();
  await page.getByLabel('Line spacing', { exact: true }).selectOption('1.5');
  await expect(input).toBeFocused();
  expect(await input.evaluate((n) => getComputedStyle(n).letterSpacing)).toBe(
    '2.5px'
  );
  await input.dispatchEvent('compositionstart');
  await input.dispatchEvent('keydown', { isComposing: true, key: 'Enter' });
  await expect(input).toBeFocused();
  await input.dispatchEvent('compositionend');
  await board.click({ position: { x: 35, y: 35 } });
  await expect(input).toHaveCount(0);
  await expect(board.locator('.select-box')).toHaveCount(0);
  await expect(body).toHaveText('Camera\ngeometry');
  // An empty point text box is a provisional edit, including when cancelled.
  await board.dblclick({ position: { x: 45, y: 48 } });
  await input.press('Escape');
  await expect(board.locator('.item[data-id]')).toHaveCount(1);
});

test('Shift H types in multiline point text and flips the object after editing', async ({
  page,
}, info) => {
  await page.goto('/');
  const art = page.locator('.artboard'),
    input = page.getByRole('textbox', { name: 'Slide text' }),
    frame = art.locator('.item[data-id]');
  await art.dblclick({ position: { x: 100, y: 120 } });
  await input.press('Enter');
  await page.keyboard.insertText('二行目');
  await input.press('Enter');
  await input.press('Shift+H');
  await expect(input).toBeFocused();
  await input.press('Meta+Enter');
  await expect(frame.locator('.item-text')).toHaveText('\n二行目\nH');
  await expect(frame).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');

  await page.keyboard.press('Shift+h');
  await expect(frame).toHaveCSS('transform', 'matrix(-1, 0, 0, 1, 0, 0)');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Meta+Shift+s');
  const path = info.outputPath('mirrored.pptx');
  await (await download).saveAs(path);
  page = await openFileWindow(page, path);
  const reopened = page.locator('.artboard .item[data-id]');
  await expect(reopened.locator('[data-paragraph]')).toHaveText([
    '',
    '二行目',
    'H',
  ]);
  await expect(reopened).toHaveCSS('transform', 'matrix(-1, 0, 0, 1, 0, 0)');
});

test('Slide layout choices create PowerPoint placeholders and reuse the selected native layout on reopen', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import('/src/model.js'),
      { layoutOptions } = await import('/src/slide-layouts.js');
    const { exportDeck } = await import('/src/export.js'),
      { importDeck, relationships } = await import('/src/import.js'),
      { updateText } = await import('/src/text.js');
    const deck = blankDeck();
    const options = layoutOptions(null, deck, deck.slides[0]);
    for (const { slide } of options) {
      slide.items.forEach((o, i) =>
        updateText(o, i ? 'Body sample' : 'Slide title')
      );
      deck.slides.push(slide);
    }
    const parts = exportDeck(deck),
      snapshot = importDeck(parts);
    const native = layoutOptions(
      { ...snapshot, parts },
      snapshot.deck,
      snapshot.deck.slides.at(-1)
    );
    const parser = new DOMParser();
    return {
      options: native.map((o) => [
        o.label,
        o.slide.layoutPath,
        !!o.slide.generatedLayout,
      ]),
      deck: snapshot.deck.slides
        .slice(1)
        .map((s) => [
          s.layoutPath,
          s.items.map((o) => [o.placeholder?.type || 'obj', o.text, o.w > 0]),
        ]),
      titleSpacing: snapshot.deck.slides
        .slice(1)
        .map((s) => s.items[0].paragraphs[0].lineHeight),
      count: relationships(
        parts.xml,
        'ppt/slideMasters/slideMaster1.xml'
      ).filter((r) => r.type === 'slideLayout').length,
      inherited: snapshot.deck.slides.slice(1).map((s) => {
        const doc = parser.parseFromString(
          parts.xml[s.source],
          'application/xml'
        );
        const placeholder = doc.getElementsByTagNameNS('*', 'sp')[0];
        return placeholder.getElementsByTagNameNS('*', 'xfrm').length === 0;
      }),
    };
  });
  expect(result.options.map((o) => o[0])).toEqual([
    'title',
    'header title',
    'title and content',
  ]);
  expect(result.options.every((o) => o[2] === false)).toBe(true);
  expect(result.titleSpacing).toEqual([1.5, 1.5, 1.5]);
  expect(result.count).toBe(4);
  expect(result.options.map((o) => o[1])).toEqual(result.deck.map((s) => s[0]));
  expect(result.deck.map((s) => s[1])).toEqual([
    [['ctrTitle', 'Slide title', true]],
    [['title', 'Slide title', true]],
    [
      ['title', 'Slide title', true],
      ['obj', 'Body sample', true],
    ],
  ]);
  expect(result.inherited).toEqual([true, true, true]);
});

test('PowerPoint preserves tracking, percentage/fixed leading, and unrelated rich typography', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { blankDeck, textItem } = await import('/src/model.js'),
      { importDeck } = await import('/src/import.js'),
      { exportDeck } = await import('/src/export.js'),
      { pdfDocument } = await import('/src/document.js');
    const { parse, child, desc, children, attr } = await import('/src/xml.js');
    const d = blankDeck(),
      path = 'ppt/slides/slide1.xml';
    d.slides[0].items.push(
      textItem('First\nSecond', 80, 60, 450, 200, 24, {
        font: 'Yu Gothic',
        letterSpacing: 2.5,
        lineHeight: 1.5,
      })
    );
    const initial = exportDeck(d);
    initial.xml[path] = initial.xml[path]
      .replace('spcPct val="150000"', 'spcPts val="3200"')
      .replace(
        '</a:r>',
        '</a:r><a:r><a:rPr spc="-50" sz="1800" b="1"><a:latin typeface="Arial"/></a:rPr><a:t> rich</a:t></a:r>'
      );
    const file = importDeck(initial),
      base = { ...file, parts: initial, deck: structuredClone(file.deck) },
      obj = file.deck.slides[0].items[0];
    obj.x += 8;
    const moved = exportDeck(file.deck, base),
      reopen = importDeck({ xml: { ...initial.xml, ...moved.xml }, media: {} });
    const o = reopen.deck.slides[0].items[0],
      fixed = o.paragraphs[0].lineHeight;
    const secondBase = {
      ...reopen,
      parts: { xml: { ...initial.xml, ...moved.xml }, media: {} },
      deck: structuredClone(reopen.deck),
    };
    o.lineHeight = 2;
    o.letterSpacing = 1.25;
    for (const p of o.paragraphs) {
      p.lineHeight = 2;
      for (const r of [p.base, ...p.runs]) r.letterSpacing = 1.25;
    }
    const edited = exportDeck(reopen.deck, secondBase);
    const verified = importDeck({
      xml: { ...initial.xml, ...moved.xml, ...edited.xml },
      media: {},
    });
    const end = verified.deck.slides[0].items[0];
    const pp = children(desc(parse(edited.xml[path]), 'txBody'), 'p').map((p) =>
      attr(child(desc(p, 'lnSpc'), 'spcPct'), 'val')
    );
    const pdf = await pdfDocument(verified.deck, {});
    return {
      fixed,
      mixed: obj.paragraphs[0].runs.map((r) => [
        r.letterSpacing,
        r.font,
        r.bold,
      ]),
      pp,
      tracking: end.paragraphs.map((p) => p.runs.map((r) => r.letterSpacing)),
      pdf:
        pdf.html.includes('letter-spacing: 1.25px') &&
        pdf.html.includes('line-height: 2.4;'),
    };
  });
  expect(result).toEqual({
    fixed: '32px',
    mixed: [
      [2.5, 'Yu Gothic', false],
      [-0.5, 'Arial', true],
    ],
    pp: ['200000', '200000'],
    tracking: [[1.25, 1.25], [1.25]],
    pdf: true,
  });
});

test('Double-clicking an overflowing text line edits that box, and wide leading keeps the caret at glyph height', async ({
  page,
}) => {
  await page.goto('/');
  const board = page.locator('.artboard');
  const editor = page.getByRole('textbox', { name: 'Slide text' });
  await board.dblclick({ position: { x: 160, y: 130 } });
  await page.keyboard.insertText('First');
  await editor.press('Enter');
  await page.keyboard.insertText('Second');
  await editor.press('Meta+Enter');
  const height = page.getByLabel('Height (px)', { exact: true });
  await height.fill('14');
  await height.press('Enter');
  await page.getByLabel('Line spacing', { exact: true }).selectOption('2');
  const point = await board.locator('.item-text').evaluate((n) => {
    const text = n.firstElementChild.firstChild;
    const range = new Range();
    range.setStart(text, 6);
    range.setEnd(text, 12);
    const r = range.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect(board.locator('[data-id]')).toHaveCount(1);
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate(() => getSelection().anchorNode.textContent)
  ).toBe('Second');
  const caret = board.locator('.glyph-caret');
  await expect(caret).toBeVisible();
  expect(await caret.evaluate((n) => parseFloat(n.style.height))).toBe(16);
  expect(
    await editor.evaluate((n) => parseFloat(getComputedStyle(n).lineHeight))
  ).toBeGreaterThan(32);
  await editor.press('Shift+ArrowRight');
  await expect(caret).toBeHidden();
});

test('Canvas zoom lays out live text at 4K and keeps the caret aligned while zooming', async ({
  browser,
}) => {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  try {
    await page.goto('http://127.0.0.1:1420');
    await page.locator('#zoom').selectOption('0.75');
    const board = page.locator('.artboard');
    const input = page.getByRole('textbox', { name: 'Slide text' });
    await board.dblclick({ position: { x: 120, y: 130 } });
    await page.getByLabel('Line spacing', { exact: true }).selectOption('2');
    await expect(input).toBeFocused();
    await page.keyboard.insertText('Typography 日本語');
    const caret = board.locator('.glyph-caret');
    await expect(caret).toBeVisible();
    const { x, y } = await caret.boundingBox();
    await page.locator('.stage').dispatchEvent('wheel', {
      deltaY: -16,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    });
    await expect(input).toBeFocused();
    const geometry = await caret.evaluate((mark) => {
      const scene = mark.closest('.scene');
      const scale = Number(getComputedStyle(scene).zoom);
      const insertion = getSelection().getRangeAt(0).getBoundingClientRect();
      const painted = mark.getBoundingClientRect();
      return {
        scale,
        xError: Math.abs(insertion.x - painted.x),
        yError: Math.abs(
          insertion.y + insertion.height / 2 - painted.y - painted.height / 2
        ),
        height: painted.height,
      };
    });
    expect(geometry.scale).toBeCloseTo(1.5 * Math.exp(16 * 0.012), 3);
    expect(geometry.xError).toBeLessThan(0.5);
    expect(geometry.yError).toBeLessThan(0.5);
    expect(geometry.height).toBeCloseTo(16 * geometry.scale, 1);
    await page.keyboard.insertText(' Clear');
    await input.press('Meta+Enter');
    await expect(board.locator('.item-text')).toHaveText('Typography 日本語 Clear');
  } finally {
    await page.close();
  }
});
