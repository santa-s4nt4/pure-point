import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

async function menuAction(page, action) {
  await page
    .getByRole('button', { name: 'Document menu', exact: true })
    .click();
  await page.locator('.menu [data-action="' + action + '"]').click();
}
async function download(page, path) {
  const ready = page.waitForEvent('download');
  await menuAction(page, 'saveAs');
  await (await ready).saveAs(path);
}
async function openFixture(page, path) {
  const ready = page.waitForEvent('filechooser');
  await menuAction(page, 'open');
  await (await ready).setFiles(path);
  await expect(page.locator('#status')).toHaveText('Saved');
}

test('編集、グリッドへの吸着、PPTXへの保存と再読み込み', async ({
  page,
}, info) => {
  await page.goto('/');
  await menuAction(page, 'new');
  await expect(page.locator('.select-slide')).toHaveCount(1);
  await page.locator('[data-preset="thirds"]').click();
  const art = page.locator('.artboard'),
    box = await art.boundingBox(),
    scale = box.width / 960;
  await page.locator('[data-action="tool-rect"]').click();
  await art.click({ position: { x: 110 * scale, y: 95 * scale } });
  const shape = art.locator('[data-id]').last(),
    rect = await shape.boundingBox();
  await page.mouse.move(rect.x + 10, rect.y + 10);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + 10 + (320 - 110 + 2) * scale,
    rect.y + 10 + (180 - 95 - 1) * scale,
    { steps: 5 }
  );
  await expect(art.locator('.guide-line')).toHaveCount(2);
  await page.mouse.up();
  await expect(page.getByLabel('X (px)', { exact: true })).toHaveValue('640');
  await expect(page.getByLabel('Y (px)', { exact: true })).toHaveValue('360');
  await page.locator('[data-action="tool-text"]').click();
  await art.click({ position: { x: 30 * scale, y: 40 * scale } });
  const text = page.getByRole('textbox', { name: 'Slide text' });
  await text.fill('文字組み & layout');
  await text.press('Meta+Enter');
  await page.getByLabel('Font family', { exact: true }).selectOption('Georgia');
  await page.getByLabel('Size (pt)', { exact: true }).fill('32');
  await page.getByLabel('Size (pt)', { exact: true }).press('Enter');
  await art.locator('[data-id]').last().dblclick();
  await expect(text).toBeVisible();
  await text.press('Escape');
  await page.locator('[data-action="addSlide"]').click();
  await expect(page.locator('.select-slide')).toHaveCount(2);
  await menuAction(page, 'undo');
  await expect(page.locator('.select-slide')).toHaveCount(1);
  const path = info.outputPath('editor.pptx');
  await download(page, path);
  await openFixture(page, path);
  await expect(art.locator('.item-text')).toHaveText('文字組み & layout');
  const parts = unzipSync(await readFile(path));
  const slide = strFromU8(parts['ppt/slides/slide1.xml']);
  expect(slide).toContain('x="4064000" y="2286000"');
  expect(slide).toContain('typeface="Georgia"');
  expect(slide).toContain('sz="3200"');
  expect(slide).not.toContain('guide-line');
});

test('元部品の保持とスライドの並び替え・削除', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('[data-action="addSlide"]').click();
  await page.locator('[data-action="addSlide"]').click();
  const original = info.outputPath('source.pptx');
  await download(page, original);
  await openFixture(page, original);
  await page.locator('.select-slide').nth(1).click({ button: 'right' });
  await page.locator('[data-action="slideUp"]').click();
  await page.locator('.select-slide').last().click({ button: 'right' });
  await page.locator('[data-action="deleteSlide"]').click();
  const target = info.outputPath('reordered.pptx');
  await download(page, target);
  await openFixture(page, target);
  await expect(page.locator('.select-slide')).toHaveCount(2);
  await expect(page.locator('.thumb-num').first()).toHaveText('1');
  const a = unzipSync(await readFile(original)),
    b = unzipSync(await readFile(target));
  expect(b['ppt/slides/slide1.xml']).toEqual(a['ppt/slides/slide1.xml']);
  expect(b['ppt/slides/slide3.xml']).toBeUndefined();
  expect(b['ppt/theme/theme1.xml']).toEqual(a['ppt/theme/theme1.xml']);
});

test('書式が混在する段落とStrict形式の座標・書体を保持する', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { blankDeck, textItem, slide } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js'),
      { importDeck } = await import('/src/import.js');
    const { namespaceDialect } = await import('/src/xml.js'),
      { updateText } = await import('/src/text.js');
    const deck = blankDeck();
    deck.slides[0].items = [textItem('Sales ', 10, 20, 300, 50, 24)];
    const original = exportDeck(deck);
    const path = 'ppt/slides/slide1.xml';
    original.xml[path] = original.xml[path].replace(
      '</a:r>',
      '</a:r><a:r><a:rPr b="1" sz="1600"><a:latin typeface="Menlo"/></a:rPr><a:t>2026</a:t></a:r>'
    );
    for (const [p, v] of Object.entries(original.xml))
      original.xml[p] = namespaceDialect(v, true);
    const read = importDeck(original),
      base = { ...read, parts: original, deck: structuredClone(read.deck) };
    const o = read.deck.slides[0].items[0];
    o.x = 72;
    updateText(o, 'Sales 2027');
    read.deck.slides.push(slide('追加'));
    const changes = exportDeck(read.deck, base);
    const reopened = importDeck({
      xml: { ...original.xml, ...changes.xml },
      media: {},
    }).deck;
    const first = reopened.slides[0].items[0];
    return {
      x: first.x,
      runs: first.paragraphs[0].runs.map((r) => [r.text, r.font, r.bold]),
      slides: reopened.slides.length,
      standard: changes.xml[path].includes(
        'http://purl.oclc.org/ooxml/presentationml/main'
      ),
    };
  });
  expect(result).toEqual({
    x: 72,
    runs: [
      ['Sales ', 'Helvetica Neue', false],
      ['2027', 'Menlo', true],
    ],
    slides: 2,
    standard: true,
  });
});
