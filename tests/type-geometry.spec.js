import { expect, test } from '@playwright/test';

test('Paragraphs follow PowerPoint baseline advances and top, middle and bottom anchors', async ({
  page,
}) => {
  await page.goto('/');
  const baselines = await page.evaluate(async () => {
    const { blankDeck, textItem } = await import('/src/model.js');
    const { scene } = await import('/src/view.js');
    const deck = blankDeck(),
      slide = deck.slides[0];
    for (const valign of ['top', 'middle', 'bottom']) {
      for (const lineHeight of [1, 1.5, 2]) {
        const o = textItem('Sample\nSample', 0, 0, 300, 150, 20, {
          font: 'Arial',
          valign,
        });
        // Master size applies to unstyled runs. Both visible runs are 20pt.
        const base = { font: 'Arial', size: 42 };
        const run = { font: 'Arial', size: 20, text: 'Sample' };
        o.paragraphs = [0, 1].map(() => ({
          base,
          runs: [run],
          lineHeight,
          align: 'left',
        }));
        slide.items.push(o);
      }
    }
    const paper = scene(slide, deck, {});
    document.body.append(paper);
    return [...paper.children].map((box) => {
      const top = box.getBoundingClientRect().top;
      return [...box.querySelectorAll('[data-paragraph] > span')].map((run) => {
        const probe = document.createElement('i');
        probe.style.cssText =
          'display:inline-block;width:0;height:0;vertical-align:baseline';
        run.prepend(probe);
        return probe.getBoundingClientRect().top - top;
      });
    });
  });
  // Measured in points from a 150pt-high PowerPoint text box with zero insets.
  const first = [19, 27, 36, 70, 67.8, 66.4, 121, 108.7, 96.7];
  baselines.forEach(([a, b], i) => {
    expect(Math.abs(a - first[i])).toBeLessThan(1.75);
    expect(Math.abs(b - a - [24, 36, 48][i % 3])).toBeLessThan(0.15);
  });
});

test('Fixed no-wrap frames and paragraph margins survive a PowerPoint round trip', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { blankDeck, textItem } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const { importDeck } = await import('/src/import.js');
    const { itemNode } = await import('/src/view.js');
    const d = blankDeck();
    d.slides[0].items.push(
      textItem('First sample\nSecond sample', 0, 0, 55, 200, 20)
    );
    const parts = exportDeck(d),
      path = 'ppt/slides/slide1.xml';
    parts.xml[path] = parts.xml[path]
      .replace('wrap="square"', 'wrap="none"')
      .replaceAll('marR="0"', 'marR="127000"')
      .replaceAll(
        '<a:spcBef><a:spcPts val="0"',
        '<a:spcBef><a:spcPts val="1100"'
      )
      .replaceAll(
        '<a:spcAft><a:spcPts val="0"',
        '<a:spcAft><a:spcPts val="1500"'
      );
    const withEdges = (enable) => {
      if (enable)
        parts.xml[path] = parts.xml[path].replace(
          '<a:bodyPr ',
          '<a:bodyPr spcFirstLastPara="1" '
        );
      const original = importDeck(parts);
      const copy = blankDeck();
      copy.slides[0].items.push({
        ...original.deck.slides[0].items[0],
        source: undefined,
      });
      const o = importDeck(exportDeck(copy)).deck.slides[0].items[0];
      const box = itemNode(o, {});
      document.body.append(box);
      const rows = [...box.querySelectorAll('[data-paragraph]')];
      return {
        noWrap: o.noWrap && !o.autoWidth,
        right: o.paragraphs[0].marginRight,
        margins: rows.map((p) => [
          p.style.marginTop,
          p.style.marginBottom,
          p.style.paddingRight,
        ]),
        wrapped: rows[0].getBoundingClientRect().height > 30,
      };
    };
    return [withEdges(false), withEdges(true)];
  });
  expect(result[0]).toEqual({
    noWrap: true,
    right: 10,
    margins: [
      ['0px', '15px', '10px'],
      ['11px', '0px', '10px'],
    ],
    wrapped: false,
  });
  expect(result[1]).toEqual({
    noWrap: true,
    right: 10,
    margins: [
      ['11px', '15px', '10px'],
      ['11px', '15px', '10px'],
    ],
    wrapped: false,
  });
});

test('Fractional paragraph advances are preserved for small captions and hard breaks', async ({
  page,
}) => {
  await page.goto('/');
  const dimensions = await page.evaluate(async () => {
    const { textItem } = await import('/src/model.js');
    const { itemNode } = await import('/src/view.js');
    const style = { font: 'Arial', size: 11 };
    const rows = [
      'Small',
      'First\nSecond',
      'Wrapped words filling several lines in a narrow text frame',
    ];
    const o = textItem(rows.join('\n'), 0, 0, 70, 200, 11);
    o.paragraphs = rows.map((text) => ({
      align: 'left',
      base: style,
      runs: [{ ...style, text }],
      lineHeight: 1.5,
    }));
    const box = itemNode(o, {});
    document.body.append(box);
    return [...box.querySelectorAll('[data-paragraph]')].map((p) => [
      parseFloat(getComputedStyle(p).minHeight),
      p.getBoundingClientRect().height,
    ]);
  });
  expect(dimensions[0][0]).toBeCloseTo(19.8);
  expect(dimensions[1][0]).toBeCloseTo(39.6);
  expect(dimensions[1][1]).toBeGreaterThan(39.5);
  expect(dimensions[2][1]).toBeGreaterThan(59);
});
