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
  const painted = art.locator('.is-line .geometry > path[stroke-dasharray]');
  await expect(painted).toHaveAttribute('marker-start', /url/);
  await expect(painted).toHaveAttribute('marker-end', /url/);
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
