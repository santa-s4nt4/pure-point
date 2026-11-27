import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';

async function drag(page, start, end) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
}

async function blank(page) {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Document menu', exact: true })
    .click();
  await page.locator('.menu [data-action=new]').click();
  const art = page.locator('.artboard');
  const box = await art.boundingBox(),
    scale = box.width / 960;
  return {
    art,
    at: (x, y) => ({ x: box.x + x * scale, y: box.y + y * scale }),
  };
}

test('Drag to draw, edit a Bézier path, and round-trip dashed connectors with arrowheads', async ({
  page,
}, info) => {
  const { art, at } = await blank(page);
  const objects = art.locator(':scope > .scene > [data-id]'),
    initial = await objects.count();
  await page.locator('[data-action=tool-ellipse]').click();
  const click = at(142, 102);
  await page.mouse.click(click.x, click.y);
  await expect(objects).toHaveCount(initial);
  await drag(page, at(350, 250), at(120, 90));
  await expect(objects).toHaveCount(initial + 1);
  const ellipse = objects.last();
  await ellipse.dblclick();
  const vertices = art.locator('.vertex-handle:not(.control)');
  await expect(vertices).toHaveCount(4);
  const vertex = await vertices.first().boundingBox();
  const start = {
    x: vertex.x + vertex.width / 2,
    y: vertex.y + vertex.height / 2,
  };
  await drag(page, start, { x: start.x - 11, y: start.y + 20 });
  await expect(art.locator('.vertex-handle.control')).toHaveCount(2);
  const segment = art.locator('[data-segment="0"]').first();
  const middle = await segment.evaluate((p) => {
    const v = p.getPointAtLength(p.getTotalLength() / 2);
    const xy = v.matrixTransform(p.getScreenCTM());
    return { x: xy.x, y: xy.y };
  });
  await page.mouse.dblclick(middle.x, middle.y);
  await expect(vertices).toHaveCount(5);
  await page.keyboard.press('Backspace');
  await expect(vertices).toHaveCount(4);
  await page.keyboard.press('Escape');
  await page.locator('[data-action=tool-line]').click();
  await drag(page, at(740, 140), at(490, 250));
  await expect(art.locator('.is-line')).toHaveCount(1);
  await page.getByLabel('Line style', { exact: true }).selectOption('dash');
  await page.getByLabel('Start arrow', { exact: true }).selectOption('oval');
  await page.getByLabel('End arrow', { exact: true }).selectOption('triangle');
  const drawing = art.locator('.is-line .geometry');
  await expect(drawing.locator('path[stroke-dasharray]')).toHaveCount(1);
  await expect(drawing.locator('path[marker-start]')).toHaveAttribute(
    'marker-end',
    /url/
  );
  const download = page.waitForEvent('download');
  await page.keyboard.press('Meta+Shift+s');
  const path = info.outputPath('vectors.pptx');
  await (await download).saveAs(path);
  const xml = strFromU8(
    unzipSync(await readFile(path))['ppt/slides/slide1.xml']
  );
  expect(xml).toContain('<p:cxnSp>');
  expect(xml).toContain('<a:cubicBezTo>');
  expect(xml).toContain('<a:prstDash val="dash"');
  expect(xml).toContain('<a:headEnd type="oval"');
  expect(xml).toContain('<a:tailEnd type="triangle"');
  const picker = page.waitForEvent('filechooser');
  await page.keyboard.press('Meta+o');
  await (await picker).setFiles(path);
  await expect(art.locator('.is-line')).toHaveCount(1);
  await art.locator('.is-line .line-hit').click();
  await expect(page.getByLabel('Start arrow', { exact: true })).toHaveValue(
    'oval'
  );
  await page.getByLabel('End arrow', { exact: true }).selectOption('diamond');
  const reexport = page.waitForEvent('download');
  await page.keyboard.press('Meta+Shift+s');
  const changed = info.outputPath('vectors-again.pptx');
  await (await reexport).saveAs(changed);
  const after = strFromU8(
    unzipSync(await readFile(changed))['ppt/slides/slide1.xml']
  );
  expect(after).toContain('type="diamond"');
  expect(after).toContain('type="oval"');
  expect(after).toContain('flipH="1"');
});

test('Resizing an image with a predominantly horizontal drag preserves its proportions', async ({
  page,
}) => {
  const { art } = await blank(page);
  const picker = page.waitForEvent('filechooser');
  await page.locator('[data-action=tool-image]').click();
  await (await picker).setFiles('tests/fixtures/image.png');
  const image = art.locator('.item:has(.image-clip)').last();
  const before = await image.boundingBox(),
    handle = await art.locator('[data-handle=se]').boundingBox();
  const start = {
    x: handle.x + handle.width / 2,
    y: handle.y + handle.height / 2,
  };
  await drag(page, start, { x: start.x + 45, y: start.y + 8 });
  const after = await image.boundingBox();
  expect(after.width).toBeGreaterThan(before.width + 5);
  expect(after.width / after.height).toBeCloseTo(
    before.width / before.height,
    2
  );
});

test('Design edits the whole curve or a selected point and keeps the handles on reopening', async ({
  page,
}, info) => {
  const { art, at } = await blank(page);
  await page.locator('[data-action=tool-line]').click();
  await drag(page, at(150, 250), at(600, 250));
  const line = art.locator('.is-line .line-hit');
  const pointOnLine = () =>
    line.evaluate((path) => {
      const middle = path
        .getPointAtLength(path.getTotalLength() / 2)
        .matrixTransform(path.getScreenCTM());
      return { x: middle.x, y: middle.y };
    });
  const mode = page.getByLabel('Line shape', { exact: true });
  await expect(mode).toHaveValue('straight');
  await mode.selectOption('curve');
  await expect(line).toHaveAttribute('d', /C/);
  await mode.selectOption('straight');
  await expect(line).toHaveAttribute('d', /L/);
  const midpoint = await pointOnLine();
  await page.mouse.dblclick(midpoint.x, midpoint.y);
  await art.locator('.vertex-handle[data-vertex="0"]').click();
  await page.getByLabel('Point type').selectOption('curve');
  const amount = page.getByLabel('Curvature (%)');
  await amount.fill('-35');
  await amount.press('Tab');
  const handle = art.locator('.vertex-handle.control');
  await expect(handle).toHaveCount(1);
  const h = await handle.boundingBox();
  const start = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  await drag(page, start, { x: start.x + 15, y: start.y + 12 });
  const percent = await amount.inputValue();
  expect(Number(percent)).not.toBe(-35);
  await page.keyboard.press('Escape');
  await page.getByLabel('End arrow', { exact: true }).selectOption('stealth');
  const save = page.waitForEvent('download');
  await page.keyboard.press('Meta+Shift+s');
  const pptx = info.outputPath('curved-line.pptx');
  await (await save).saveAs(pptx);
  const xml = strFromU8(
    unzipSync(await readFile(pptx))['ppt/slides/slide1.xml']
  );
  expect(xml).toMatch(
    /<p:cxnSp>.*?<a:cubicBezTo>.*?<a:tailEnd type="stealth"/s
  );
  const originalId = await art.locator('.is-line').getAttribute('data-id');
  const open = page.waitForEvent('filechooser');
  await page.keyboard.press('Meta+o');
  await (await open).setFiles(pptx);
  await expect(art.locator('.is-line')).not.toHaveAttribute('data-id', originalId);
  await expect(line).toHaveAttribute('d', /C/);
  const reopened = await pointOnLine();
  await page.mouse.dblclick(reopened.x, reopened.y);
  await art.locator('.vertex-handle[data-vertex="0"]').click();
  await expect(amount).toHaveValue(percent);
  await expect(page.getByLabel('End arrow', { exact: true })).toHaveValue(
    'stealth'
  );
});

test('Heavy strokes stop inside each arrowhead at both endpoints', async ({
  page,
}) => {
  await page.goto('/icon.png');
  const results = await page.evaluate(async () => {
    const { vectorDrawing } = await import('/src/vector-view.js');
    async function pixels(svg) {
      const image = new Image();
      image.src =
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(new XMLSerializer().serializeToString(svg));
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 220;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, 220, 80).data;
      return (x, y) => data[(y * 220 + x) * 4 + 3];
    }
    const results = {};
    for (const head of ['triangle', 'stealth', 'arrow', 'diamond', 'oval']) {
      const svg = vectorDrawing({
        kind: 'line',
        w: 200,
        h: 0,
        stroke: '#111111',
        strokeWidth: 12,
        startArrow: head,
        endArrow: head,
      });
      svg.setAttribute('viewBox', '-10 -40 220 80');
      svg.setAttribute('width', 220);
      svg.setAttribute('height', 80);
      const full = await pixels(svg);
      svg.querySelector('path[mask]').remove();
      const tips = await pixels(svg);
      let protrusion = 0;
      for (const x of [10, 11, 208, 209]) {
        for (let y = 35; y < 45; y++)
          protrusion = Math.max(protrusion, full(x, y) - tips(x, y));
      }
      const joined = Array.from({ length: 194 }, (_, i) =>
        full(i + 13, 40)
      ).every((a) => a > 100);
      results[head] = {
        protrusion,
        joined,
        headPainted: tips(20, 40) > 100 || tips(13, 40) > 100,
      };
    }
    return results;
  });
  for (const [head, result] of Object.entries(results))
    expect(result, head).toEqual({
      protrusion: 0,
      joined: true,
      headPainted: true,
    });
});

test('Changing a middle point to a curve couples its tangents and bounds extreme input', async ({
  page,
}) => {
  await page.goto('/icon.png');
  const result = await page.evaluate(async () => {
    const { shape } = await import('/src/model.js');
    const { setCurvature, moveVertex, localContours, curveSettings } =
      await import('/src/vector.js');
    const line = shape('line', 'Line', 10, 30, 200, 0, {
      contours: [
        {
          closed: false,
          nodes: [
            { x: 0, y: 0 },
            { x: 300, y: 0 },
            { x: 1000, y: 0 },
          ],
        },
      ],
    });
    const key = { path: 0, vertex: 1 };
    const center = () => localContours(line)[0].nodes[1];
    const alignment = () => {
      const n = center(),
        a = [n.in.x - n.x, n.in.y - n.y],
        b = [n.out.x - n.x, n.out.y - n.y];
      return (
        (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b))
      );
    };
    setCurvature(line, key, 45);
    const initial = center();
    const converted = alignment(),
      amount = curveSettings(line, key).percent;
    moveVertex(
      line,
      structuredClone(line),
      { ...key, arm: 'out' },
      { x: initial.x - 10, y: initial.y + 35 }
    );
    const dragged = alignment(),
      smooth = center();
    moveVertex(
      line,
      structuredClone(line),
      { ...key, arm: 'out' },
      { x: smooth.x + 50, y: smooth.y },
      true
    );
    const independent = alignment();
    const corner = center();
    moveVertex(
      line,
      structuredClone(line),
      { ...key, arm: 'in' },
      { x: corner.x - 23, y: corner.y + 25 }
    );
    const after = center();
    const cornerPreserved = Math.hypot(
      corner.out.x - corner.x - (after.out.x - after.x),
      corner.out.y - corner.y - (after.out.y - after.y)
    );
    setCurvature(line, key, 1e308);
    const bounded = [line.x, line.y, line.w, line.h].every(
      (v) => Number.isFinite(v) && Math.abs(v) < 1000
    );
    return {
      converted,
      amount,
      dragged,
      independent,
      cornerPreserved,
      bounded,
    };
  });
  expect(result.converted).toBeCloseTo(-1, 8);
  expect(result.amount).toBe(45);
  expect(result.dragged).toBeCloseTo(-1, 8);
  expect(result.independent).toBeGreaterThan(-0.99);
  expect(result.cornerPreserved).toBeCloseTo(0, 8);
  expect(result.bounded).toBe(true);
});

test('Text-box handles change width and height independently', async ({
  page,
}) => {
  const { art } = await blank(page);
  await art.dblclick({ position: { x: 90, y: 60 } });
  const editor = page.getByRole('textbox', { name: 'Slide text' });
  await editor.fill('Text box');
  await editor.press('Meta+Enter');
  const text = art.locator('.item:has(.item-text)');
  await text.click();
  const before = await text.boundingBox();
  const handle = art.locator('[data-handle=se]');
  const moveCorner = async (dx, dy) => {
    const b = await handle.boundingBox();
    const start = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await drag(page, start, { x: start.x + dx, y: start.y + dy });
  };
  await page.keyboard.down('Alt');
  await moveCorner(68, 0);
  const wider = await text.boundingBox();
  expect(wider.width - before.width).toBeCloseTo(68, 0);
  expect(wider.height).toBeCloseTo(before.height, 1);
  await moveCorner(0, 45);
  await page.keyboard.up('Alt');
  const taller = await text.boundingBox();
  expect(taller.width).toBeCloseTo(wider.width, 1);
  expect(taller.height - wider.height).toBeCloseTo(45, 0);
});

test('Custom geometry keeps compound-path cutouts and horizontal line vertices editable', async ({
  page,
}) => {
  await page.goto('/icon.png');
  const result = await page.evaluate(async () => {
    const { shape } = await import('/src/model.js');
    const { createAt, sizeDraft, splitEdge, moveVertex } =
      await import('/src/vector.js');
    const { geometryXML, readContours } = await import('/src/vector-xml.js');
    const { itemNode } = await import('/src/view.js');
    const { parse, ns, desc } = await import('/src/xml.js');
    const ring = shape('path', 'Ring', 20, 40, 100, 100, {
      fill: '#3459dd',
      contours: [
        {
          pathIndex: 0,
          closed: true,
          nodes: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 1000, y: 1000 },
            { x: 0, y: 1000 },
          ],
        },
        {
          pathIndex: 0,
          closed: true,
          nodes: [
            { x: 250, y: 250 },
            { x: 250, y: 750 },
            { x: 750, y: 750 },
            { x: 750, y: 250 },
          ],
        },
      ],
    });
    const mounted = itemNode(ring, {});
    document.body.append(mounted);
    const drawing = mounted.querySelector('svg>path');
    const source = parse(
      '<p:root ' + ns + '>' + geometryXML(ring) + '</p:root>'
    );
    const reopened = readContours(desc(source, 'custGeom'), { w: 100, h: 100 });
    const line = createAt('line', { x: 50, y: 30 });
    sizeDraft(line, { x: 50, y: 30 }, { x: 200, y: 30 }, false);
    splitEdge(line, 0, 0, { x: 75, y: 0 });
    const flat = itemNode(line, {}, true);
    moveVertex(
      line,
      structuredClone(line),
      { path: 0, vertex: 1 },
      { x: 75, y: 40 }
    );
    return {
      ringHole: drawing.isPointInFill(new DOMPoint(50, 50)),
      ringEdge: drawing.isPointInFill(new DOMPoint(12, 50)),
      paths: source.getElementsByTagNameNS('*', 'path').length,
      subpaths: reopened.map((c) => c.nodes.length),
      flatHeight: flat.style.height,
      editableHit: !!flat.querySelector('.line-hit'),
      raisedHeight: line.h,
    };
  });
  expect(result).toEqual({
    ringHole: false,
    ringEdge: true,
    paths: 1,
    subpaths: [4, 4],
    flatHeight: '1px',
    editableHit: true,
    raisedHeight: 40,
  });
});

test('PowerPoint curved connector presets keep their adjustment guides on resize and their edited Béziers on save', async ({
  page,
}) => {
  await page.goto('/icon.png');
  const result = await page.evaluate(async () => {
    const { blankDeck, shape } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const { importDeck } = await import('/src/import.js');
    const { localContours, setCurvature } = await import('/src/vector.js');
    const { itemNode } = await import('/src/view.js');
    const { parse, attr, desc } = await import('/src/xml.js');
    const deck = blankDeck();
    deck.slides[0].items = [2, 3, 4, 5].map((n) =>
      shape('line', 'Curve ' + n, 20, 20, 200, 100, { stroke: '#345678' })
    );
    const parts = exportDeck(deck);
    const path = 'ppt/slides/slide1.xml';
    const adjustments = [[], [25000], [25000, 80000], [-10000, 60000, 120000]];
    let index = 0;
    parts.xml[path] = parts.xml[path].replace(
      /<a:prstGeom prst="line">[\s\S]*?<\/a:prstGeom>/g,
      () => {
        const i = index++;
        const guides = adjustments[i]
          .map(
            (v, j) => '<a:gd name="adj' + (j + 1) + '" fmla="val ' + v + '"/>'
          )
          .join('');
        return (
          '<a:prstGeom prst="curvedConnector' +
          (i + 2) +
          '"><a:avLst>' +
          guides +
          '</a:avLst></a:prstGeom>'
        );
      }
    );
    const opened = importDeck(parts);
    const base = { ...opened, parts, deck: structuredClone(opened.deck) };
    const items = opened.deck.slides[0].items;
    const untouched = !exportDeck(opened.deck, base).xml[path];
    const anchors = items.map((o) =>
      o.contours[0].nodes.map(({ x, y }) => [x, y])
    );
    const firstControls = items.map((o) => {
      const [a, b] = o.contours[0].nodes;
      return [a.out.x, a.out.y, b.in.x, b.in.y];
    });
    const curves = items.map(
      (o) =>
        (
          itemNode(o, {}, true)
            .querySelector('.geometry > path')
            .getAttribute('d')
            .match(/C/g) || []
        ).length
    );
    items.forEach((o) => {
      o.w *= 2;
    });
    const resized = exportDeck(opened.deck, base).xml[path];
    const presetNames = [
      ...parse(resized).getElementsByTagNameNS('*', 'prstGeom'),
    ].map((el) => attr(el, 'prst'));
    const last = items.at(-1);
    setCurvature(last, { path: 0, vertex: 2 }, 24);
    const edited = exportDeck(opened.deck, base).xml[path];
    const again = importDeck({
      ...parts,
      xml: { ...parts.xml, [path]: edited },
    }).deck.slides[0].items.at(-1);
    const coordinates = (o) =>
      localContours(o)[0].nodes.flatMap((v) =>
        [v, v.in, v.out].filter(Boolean).flatMap(({ x, y }) => [x, y])
      );
    const expected = coordinates(last),
      actual = coordinates(again);
    return {
      untouched,
      anchors,
      firstControls,
      curves,
      presetNames,
      retainsGuide: resized.includes('val 120000'),
      editedAsConnector: !!desc(
        parse(edited).getElementsByTagNameNS('*', 'cxnSp')[3],
        'custGeom'
      ),
      reopened: again.kind,
      maxError: Math.max(...expected.map((n, i) => Math.abs(n - actual[i]))),
    };
  });
  expect(result.untouched).toBe(true);
  expect(result.curves).toEqual([1, 2, 3, 4]);
  expect(result.anchors).toEqual([
    [
      [0, 0],
      [1000, 1000],
    ],
    [
      [0, 0],
      [250, 500],
      [1000, 1000],
    ],
    [
      [0, 0],
      [250, 400],
      [625, 800],
      [1000, 1000],
    ],
    [
      [0, 0],
      [-100, 300],
      [550, 600],
      [1200, 800],
      [1000, 1000],
    ],
  ]);
  expect(result.firstControls).toEqual([
    [500, 0, 1000, 500],
    [125, 0, 250, 250],
    [125, 0, 250, 200],
    [-50, 0, -100, 150],
  ]);
  expect(result.presetNames).toEqual(
    [2, 3, 4, 5].map((n) => 'curvedConnector' + n)
  );
  expect(result.retainsGuide).toBe(true);
  expect(result.editedAsConnector).toBe(true);
  expect(result.reopened).toBe('line');
  expect(result.maxError).toBeLessThan(0.001);
});
