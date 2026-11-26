import { expect, test } from '@playwright/test';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

async function openSlides(page, file) {
  await page.locator('.p-menu').click();
  const picking = page.waitForEvent('filechooser');
  await page.locator('[data-action=open]').click();
  await (
    await picking
  ).setFiles({
    name: 'Layers.pptx',
    mimeType: 'application/octet-stream',
    buffer: file,
  });
  await expect(page.locator('#status')).toHaveText('Saved');
}

async function makeDeck(page) {
  await page.goto('/');
  const parts = await page.evaluate(async () => {
    const { shape, slide } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const rear = shape('rect', 'Rear', 40, 60, 80, 60, { fill: '#FF0022' });
    const front = shape('rect', 'Front', 240, 190, 90, 65, { fill: '#334455' });
    return exportDeck(
      {
        w: 960,
        h: 540,
        slides: [
          slide('', '#FFFFFF', [rear, front]),
          slide(),
          slide(),
          slide(),
        ],
      },
      null
    ).xml;
  });
  await openSlides(
    page,
    Buffer.from(
      zipSync(
        Object.fromEntries(
          Object.entries(parts).map(([k, v]) => [k, strToU8(v)])
        )
      )
    )
  );
}

test('Slide selections in the navigator use section and deletion shortcuts', async ({
  page,
}) => {
  await makeDeck(page);
  await expect(page.locator('.inspector [data-action=slides]')).toHaveCount(0);
  const pages = page.locator('.rail');
  await pages.locator('[data-slide="1"]').click();
  await pages.locator('[data-slide="2"]').click({ modifiers: ['Meta'] });
  await page.keyboard.press('Meta+g');
  await page.getByLabel('Section name').fill('Middle');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(pages.getByRole('button', { name: /Middle/ })).toBeVisible();
  await expect(pages.locator('.chosen')).toHaveCount(2);
  await page.keyboard.press('Backspace');
  await expect(pages.locator('[data-slide]')).toHaveCount(2);
  await page.keyboard.press('Meta+z');
  await expect(pages.locator('[data-slide]')).toHaveCount(4);
  await pages.locator('[data-slide="3"]').click();
  await page.keyboard.press('Delete');
  await expect(pages.locator('[data-slide]')).toHaveCount(3);
});

test('Alignment, live color, layer ordering, and object comments round-trip', async ({
  page,
}) => {
  await makeDeck(page);
  const art = page.locator('.artboard'),
    objects = art.locator('.scene > [data-id]');
  await objects.first().click();
  await page.locator('[data-action=objectAlign-right]').click();
  await expect(
    page.getByRole('spinbutton', { name: 'X (px)', exact: true })
  ).toHaveValue('1760');
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  await page.getByLabel('Hex color').fill('009966');
  await expect(page.locator('[data-color=fill]')).toContainText('009966');
  await page.keyboard.press('Meta+z');
  await expect(page.locator('[data-color=fill]')).toContainText('FF0022');
  await page.locator('[data-color=fill]').click();
  await page.getByLabel('Hex color').fill('#009966');
  await page.getByRole('button', { name: 'Close color picker' }).click();
  await expect(page.locator('[data-color=fill]')).toContainText('009966');
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await page.locator('[data-action=objectAlign-top]').click();
  const tops = await objects.evaluateAll((nodes) =>
    nodes.map((n) => n.getBoundingClientRect().y)
  );
  expect(tops[0]).toBeCloseTo(tops[1], 3);
  await page.locator('[data-action=layers]').click();
  const rows = page.locator('.layer-row');
  await rows.nth(1).locator('[data-layer]').click();
  await rows.nth(1).dragTo(rows.first(), { targetPosition: { x: 40, y: 2 } });
  await expect(rows.first().locator('[data-layer]')).toHaveText('Rear');
  await rows.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add comment…' }).click();
  await expect(page.getByText('Comment on Rear')).toBeVisible();
  await page
    .getByLabel('Comment', { exact: true })
    .fill('Keep the green shape');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.locator('.comment-card .comment-target')).toHaveText(
    'Rear'
  );
  await page.locator('.p-menu').click();
  const download = page.waitForEvent('download');
  await page.locator('[data-action=saveAs]').click();
  const chunks = [];
  for await (const chunk of await (await download).createReadStream())
    chunks.push(chunk);
  const file = Buffer.concat(chunks),
    zip = unzipSync(file);
  const comments = Object.entries(zip).find(
    ([p]) => p.includes('/comments/') && p.endsWith('.xml')
  );
  expect(strFromU8(comments[1])).toContain('ac:deMkLst');
  await openSlides(page, file);
  await page.locator('[data-action=comments]').click();
  await expect(page.locator('.comment-card .comment-target')).toHaveText(
    'Rear'
  );
  await page.locator('[data-action=layers]').click();
  await expect(rows.first().locator('[data-layer]')).toHaveText('Rear');
});

test('Color picker previews drags, formats, document colors and opacity, then reopens editable PowerPoint paint', async ({
  page,
}) => {
  await makeDeck(page);
  const rear = page.locator('.artboard .scene > [data-id]').first();
  await rear.click();
  const trigger = page.locator('[data-color=fill]');
  await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Fill color picker' });
  const square = picker.getByLabel('Saturation and brightness');
  const bounds = await square.boundingBox();
  await page.mouse.move(bounds.x + 8, bounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.55,
    bounds.y + bounds.height * 0.4,
    { steps: 8 }
  );
  const live = await trigger.getAttribute('data-value');
  expect(live).not.toBe('#FF0022');
  await expect(rear.locator('path[fill]').first()).toHaveAttribute(
    'fill',
    live
  );
  await page.mouse.up();
  await page.keyboard.press('Meta+z');
  await expect(trigger).toHaveAttribute('data-value', '#FF0022');
  await trigger.click();
  await picker.getByRole('button', { name: '#334455', exact: true }).click();
  await expect(trigger).toHaveAttribute('data-value', '#334455');
  const model = picker.getByLabel('Color format');
  await model.selectOption('RGB');
  await picker.getByLabel('Red', { exact: true }).fill('255');
  await expect(trigger).toHaveAttribute('data-value', '#FF4455');
  await model.selectOption('HSB');
  await picker.getByLabel('Saturation', { exact: true }).fill('0');
  await expect(trigger).toHaveAttribute('data-value', '#FFFFFF');
  await model.selectOption('HSL');
  await picker.getByLabel('Lightness').fill('0');
  await expect(trigger).toHaveAttribute('data-value', '#000000');
  await model.selectOption('CSS');
  await picker.getByLabel('CSS color').fill('rgb(10 20 30 / 50%)');
  await expect(trigger).toHaveAttribute('data-value', '#0A141E80');
  await model.selectOption('Hex');
  await picker.getByLabel('Opacity', { exact: true }).fill('40');
  await expect(trigger).toHaveAttribute('data-value', '#0A141E66');
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.locator('.p-menu').click();
  await page.locator('.menu [data-action=saveAs]').click();
  const stream = await (await download).createReadStream();
  const chunks = [];
  for await (const part of stream) chunks.push(part);
  const zip = Buffer.concat(chunks);
  expect(strFromU8(unzipSync(zip)['ppt/slides/slide1.xml'])).toContain(
    '<a:alpha val="40000"'
  );
  await openSlides(page, zip);
  await page.locator('.artboard .scene > [data-id]').first().click();
  await expect(trigger).toHaveAttribute('data-value', '#0A141E66');
});

test('The same live paint controls edit slide backgrounds, strokes and inline text', async ({
  page,
}) => {
  await makeDeck(page);
  const art = page.locator('.artboard'),
    bg = page.locator('[data-color=bg]');
  await bg.click();
  await page.getByLabel('Hex color').fill('DDF0E2');
  await expect(art.locator(':scope > .scene')).toHaveCSS(
    'background-color',
    'rgb(221, 240, 226)'
  );
  await page.keyboard.press('Escape');
  const rear = art.locator('.scene > [data-id]').first();
  await rear.click();
  const stroke = page.locator('[data-color=stroke]');
  await stroke.click();
  await page.getByLabel('Hex color').fill('F00023CC');
  await expect(rear.locator('path[stroke]').first()).toHaveAttribute(
    'stroke',
    '#F00023CC'
  );
  await page.getByLabel('Paint type').selectOption('none');
  await expect(stroke).toHaveAttribute('data-value', '');
  await page.keyboard.press('Escape');
  await art.dblclick({ position: { x: 180, y: 130 } });
  const text = page.getByRole('textbox', { name: 'Slide text' });
  await text.fill('Live text');
  await page.locator('[data-color=color]').click();
  await page.getByLabel('Hex color').fill('2244AA');
  await expect(text).toHaveCSS('color', 'rgb(34, 68, 170)');
  await page.keyboard.press('Escape');
  await expect(text).toHaveText('Live text');
});

test('The navigator pastes independent slides in order, including notes and imported objects', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await makeDeck(page);
  const tiles = page.locator('.rail [data-slide]');
  await page.locator('header [data-action=script]').click();
  for (const [i, note] of ['First', 'Second', 'Third', 'Fourth'].entries()) {
    await tiles.nth(i).click();
    await page.getByLabel('Slide script').fill(note);
  }
  await tiles.nth(2).click();
  await tiles.nth(0).click({ modifiers: ['Meta'] });
  await page.keyboard.press('Meta+c');
  await page.keyboard.press('Meta+v');
  await expect(tiles).toHaveCount(6);
  await expect(page.locator('.rail .chosen')).toHaveCount(2);
  await expect(page.locator('.rail .active')).toHaveAttribute(
    'data-slide',
    '3'
  );
  await expect(page.locator('.artboard [data-id]')).toHaveCount(2);
  await page.keyboard.press('Meta+z');
  await expect(tiles).toHaveCount(4);
  await page.keyboard.press('Meta+Shift+z');
  await expect(tiles).toHaveCount(6);
  await tiles.nth(3).click();
  await page.getByLabel('Slide script').fill('Edited copy');
  await tiles.nth(3).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Copy slides/ }).click();
  await tiles.nth(5).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Paste slides/ }).click();
  await expect(tiles).toHaveCount(7);
  await page.locator('.p-menu').click();
  const download = page.waitForEvent('download');
  await page.locator('[data-action=saveAs]').click();
  const stream = await (await download).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  await openSlides(page, Buffer.concat(chunks));
  for (const [i, note] of [
    'First',
    'Second',
    'Third',
    'Edited copy',
    'Third',
    'Fourth',
    'Edited copy',
  ].entries()) {
    await tiles.nth(i).click();
    await expect(page.getByLabel('Slide script')).toHaveValue(note);
    await expect(page.locator('.artboard [data-id]')).toHaveCount(
      [0, 3, 6].includes(i) ? 2 : 0
    );
  }
});
