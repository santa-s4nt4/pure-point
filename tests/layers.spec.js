import { expect, test } from '@playwright/test';

test('Grouping reuses source XML and preserves shape IDs, visibility and locks', async ({
  page,
}) => {
  await page.goto('/icon.png');
  const result = await page.evaluate(async () => {
    const { blankDeck, shape, textItem } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const { importDeck } = await import('/src/import.js');
    const { layerEntries, makeGroup, ungroup } = await import('/src/layers.js');
    const { parse, serialize, desc, children, attr } =
      await import('/src/xml.js');
    const source = blankDeck(),
      s = source.slides[0];
    s.items = [
      shape('ellipse', 'Planet', 50, 90, 80, 40),
      textItem('Note', 160, 110, 180, 40, 26),
    ];
    const parts = exportDeck(source);
    const path = 'ppt/slides/slide1.xml',
      xml = parse(parts.xml[path]);
    const first = children(desc(xml, 'spTree'), 'sp')[0];
    const extensions = xml.createElementNS('urn:test:extension', 't:fixture');
    extensions.setAttribute('preserve', 'true');
    desc(first, 'cNvPr').append(extensions);
    parts.xml[path] = serialize(xml);
    const doc = importDeck(parts),
      base = { ...doc, parts, deck: structuredClone(doc.deck) },
      items = doc.deck.slides[0].items;
    const group = makeGroup([...layerEntries(items).values()]);
    group.x += 24;
    group.rotation = 30;
    group.locked = true;
    group.items[0].hidden = true;
    const merged = (parts, patch) => ({
      xml: { ...parts.xml, ...patch.xml },
      media: { ...parts.media, ...patch.media },
    });
    const grouped = merged(parts, exportDeck(doc.deck, base)),
      reopened = importDeck(grouped);
    const parsed = parse(grouped.xml[path]),
      childrenOfGroup = children(desc(parsed, 'spTree'), 'grpSp')[0];
    const ids = children(childrenOfGroup, 'sp').map((n) => [
      attr(desc(n, 'cNvPr'), 'id'),
      attr(desc(n, 'cNvPr'), 'name'),
    ]);
    const after = reopened.deck.slides[0].items[0],
      copy = structuredClone(reopened.deck);
    const groupFlags = [after.kind, after.locked, after.items[0].hidden];
    delete after.locked;
    ungroup(layerEntries(reopened.deck.slides[0].items).get(after.id));
    const flat = exportDeck(reopened.deck, {
      ...reopened,
      parts: grouped,
      deck: copy,
    });
    const afterXML = parse(flat.xml[path]),
      tree = desc(afterXML, 'spTree');
    return {
      ids,
      groupFlags,
      count: children(tree, 'sp').length,
      groups: children(tree, 'grpSp').length,
      marker: attr(desc(tree, 'fixture'), 'preserve'),
      rotation:
        Number(attr(desc(children(tree, 'sp')[1], 'xfrm'), 'rot')) / 60000,
    };
  });
  expect(result).toEqual({
    ids: [
      ['2', 'Planet'],
      ['3', 'Note'],
    ],
    groupFlags: ['group', true, true],
    count: 2,
    groups: 0,
    marker: 'true',
    rotation: 30,
  });
});

test('Layer and canvas selection, marquee, keyboard groups, visibility and lock', async ({
  page,
}) => {
  await page.goto('/');
  // Use a known blank presentation so the installed user's template cannot
  // change test geometry or initial layer count.
  const fixture = await page.evaluate(async () => {
    const { blankDeck, shape } = await import('/src/model.js'),
      { exportDeck } = await import('/src/export.js');
    const { zipSync, strToU8 } =
      await import('/node_modules/fflate/esm/browser.js');
    const d = blankDeck();
    d.slides[0].items = [
      shape('rect', 'Square A', 80, 60, 120, 70, { fill: '#3434CC' }),
      shape('ellipse', 'Circle B', 260, 70, 110, 80, { fill: '#CC4433' }),
    ];
    const files = Object.fromEntries(
      Object.entries(exportDeck(d).xml).map(([k, v]) => [k, strToU8(v)])
    );
    return Array.from(zipSync(files));
  });
  const picker = page.waitForEvent('filechooser');
  await page.keyboard.press('Meta+o');
  await (
    await picker
  ).setFiles({
    name: 'layers.pptx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(fixture),
  });
  const art = page.locator('.artboard'),
    nodes = art.locator(':scope > .scene > [data-id]');
  await expect(nodes).toHaveCount(2);
  await nodes.nth(0).click();
  await nodes.nth(1).click({ modifiers: ['Shift'] });
  await expect(art.locator('.selection-outline')).toHaveCount(2);
  await page.keyboard.press('Meta+g');
  await expect(nodes).toHaveCount(1);
  const childrenBox = await art
    .locator('.group-content > .item')
    .evaluateAll((children) => {
      const rects = children.map((n) => n.getBoundingClientRect());
      return [
        Math.min(...rects.map((r) => r.left)),
        Math.max(...rects.map((r) => r.right)),
      ];
    });
  const groupBox = await art.locator('.select-box').boundingBox();
  expect(groupBox.x).toBeCloseTo(childrenBox[0], 1);
  expect(groupBox.x + groupBox.width).toBeCloseTo(childrenBox[1], 1);
  await art.click({ position: { x: 10, y: 10 } });
  await expect(art.locator('.select-box')).toHaveCount(0);
  await art.locator('.group-content > .item').first().click();
  await page.keyboard.press('Meta+Shift+g');
  await expect(nodes).toHaveCount(2);
  const frame = await art.boundingBox(),
    left = await nodes.nth(0).boundingBox(),
    right = await nodes.nth(1).boundingBox();
  await page.mouse.move(frame.x + 2, frame.y + 2);
  await page.mouse.down();
  await page.mouse.move(
    right.x + right.width + 8,
    Math.max(left.y + left.height, right.y + right.height) + 8,
    { steps: 4 }
  );
  await page.mouse.up();
  await expect(art.locator('.selection-outline')).toHaveCount(2);
  await page.locator('[data-action=layers]').click();
  const row = (name) => page.getByRole('button', { name, exact: true });
  await row('Square A').click();
  await row('Circle B').click({ modifiers: ['Meta'] });
  await page
    .getByRole('button', { name: 'Group selection', exact: true })
    .click();
  await expect(nodes).toHaveCount(1);
  await page.getByRole('button', { name: 'Lock Group', exact: true }).click();
  await expect(nodes.first()).toHaveClass(/locked-layer/);
  await page.keyboard.press('Backspace');
  await expect(nodes).toHaveCount(1);
  await page.getByRole('button', { name: 'Unlock Group', exact: true }).click();
  await page.getByRole('button', { name: 'Hide Group', exact: true }).click();
  await expect(nodes.first()).toBeHidden();
  await page.getByRole('button', { name: 'Show Group', exact: true }).click();
  await expect(nodes.first()).toBeVisible();
  await page.getByRole('button', { name: 'Expand group', exact: true }).click();
  await expect(row('Square A')).toBeVisible();
  await page
    .getByRole('button', { name: 'Hide Square A', exact: true })
    .click();
  await expect(art.locator('.group-content > .item').first()).toBeHidden();
});

test('Padded PowerPoint groups fit their visible children without moving them, including after save', async ({
  page,
}) => {
  await page.goto('/icon.png');
  const result = await page.evaluate(async () => {
    const { shape, blankDeck } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const { importDeck } = await import('/src/import.js');
    const { layerEntries, fitGroups, layerBounds } =
      await import('/src/layers.js');
    const child = shape('rect', 'Picture frame', 220, 110, 40, 25);
    const g = shape('group', 'Padded', 150, 85, 200, 60, {
      rotation: 27,
      flipH: true,
      childBox: [100, 80, 200, 120],
      items: [child],
    });
    const d = blankDeck();
    d.slides[0].items = [g];
    const bounds = (items) => {
      const entry = [...layerEntries(items).values()].find(
        (e) => e.object.kind === 'rect'
      );
      return layerBounds(entry);
    };
    const original = bounds([g]);
    const parts = exportDeck(d);
    const file = importDeck(parts);
    const base = { ...file, parts, deck: structuredClone(file.deck) };
    const first = file.deck.slides[0].items[0];
    const imported = bounds([first]);
    first.items[0].w /= 2;
    const edited = bounds([first]);
    fitGroups([first]);
    const changes = exportDeck(file.deck, base);
    const reopened = importDeck({
      xml: { ...parts.xml, ...changes.xml },
      media: {},
    }).deck.slides[0].items;
    return {
      original,
      imported,
      edited,
      reloaded: bounds(reopened),
      width: reopened[0].w,
      height: reopened[0].h,
    };
  });
  for (const key of ['x', 'y', 'w', 'h']) {
    expect(result.imported[key]).toBeCloseTo(result.original[key], 5);
    expect(result.reloaded[key]).toBeCloseTo(result.edited[key], 3);
  }
  expect(result.width).toBeCloseTo(20, 4);
  expect(result.height).toBeCloseTo(12.5, 4);
});
