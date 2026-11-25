import { test, expect } from '@playwright/test';

test('Text edits use the existing glyphs, stay editable through spacing changes, and release selection outside', async ({
  page,
}) => {
  await page.goto('/');
  const board = page.locator('.artboard'),
    input = page.getByRole('textbox', { name: 'Slide text' });
  await board.dblclick({ position: { x: 110, y: 115 } });
  await expect(input).toBeFocused();
  await expect(page.getByLabel('Size (pt)', { exact: true })).toHaveValue('24');
  await expect(page.getByLabel('Font family', { exact: true })).toHaveValue(
    'Yu Gothic'
  );
  await page.keyboard.insertText('Camera');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('geometry');
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
        pdf.html.includes('line-height: 2.42'),
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
