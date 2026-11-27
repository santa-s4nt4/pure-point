import { openFileWindow } from './document-window.js';
import { test, expect } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readFile } from 'node:fs/promises';

async function openRichText(page) {
  await page.goto('/');
  const parts = await page.evaluate(async () => {
    const { blankDeck, textItem } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const deck = blankDeck(),
      path = 'ppt/slides/slide1.xml';
    deck.slides[0].items.push(textItem('original', 50, 40, 430, 150, 32));
    const { xml } = exportDeck(deck);
    const paragraphs = [
      '<a:p><a:pPr algn="ctr"><a:defRPr sz="3200"/></a:pPr><a:r><a:rPr sz="1200"/><a:t>Light</a:t></a:r><a:r><a:rPr sz="900" b="1"/><a:t>Small</a:t></a:r></a:p>',
      '<a:p><a:endParaRPr sz="1100" u="sng"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:highlight><a:srgbClr val="263880"/></a:highlight></a:endParaRPr></a:p>',
      '<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1000"/><a:t>Final</a:t></a:r></a:p>',
    ];
    xml[path] = xml[path].replace(
      /<p:txBody>[\s\S]*?<\/p:txBody>/,
      '<p:txBody><a:bodyPr wrap="none" anchor="ctr"><a:spAutoFit/></a:bodyPr><a:lstStyle/>' +
        paragraphs.join('') +
        '</p:txBody>'
    );
    return xml;
  });
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries(parts).map(([name, contents]) => [name, strToU8(contents)])
    )
  );
  page = await openFileWindow(page, {
    name: 'Rich.pptx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from(bytes),
  });
  const frame = page.locator('.artboard .item[data-id]').first();
  await expect(frame).toContainText('LightSmall');
  return page;
}

test('Entering a centered PowerPoint auto-fit frame preserves glyph positions and uses a run-sized caret', async ({
  page,
}) => {
  page = await openRichText(page);
  const frame = page.locator('.artboard .item[data-id]').first();
  const glyph = frame.locator('span').filter({ hasText: /^Final$/ });
  const original = await glyph.boundingBox(),
    bounds = await frame.boundingBox();
  await frame.click();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: 'Slide text' });
  await expect(editor).toBeFocused();
  expect(await frame.boundingBox()).toEqual(bounds);
  expect(await glyph.boundingBox()).toEqual(original);
  const caret = await editor.evaluate(() => {
    const s = getSelection();
    return {
      text: s.anchorNode.textContent,
      type: s.anchorNode.nodeType,
      offset: s.anchorOffset,
      height: s.getRangeAt(0).getBoundingClientRect().height,
    };
  });
  expect(caret).toMatchObject({ text: 'Final', type: 3, offset: 5 });
  expect(caret.height).toBeGreaterThan(0);
  expect(Math.abs(caret.height - original.height)).toBeLessThan(2);
  // A blank row and the beginning of the next row share a flattened text
  // offset. Changing tracking in the inspector must restore each correctly.
  for (const [index, tracking] of [
    [1, '1.1'],
    [2, '1.2'],
  ]) {
    await editor.evaluate((n, i) => {
      const line = n.querySelector('[data-paragraph="' + i + '"]');
      getSelection().collapse(
        line.querySelector('span')?.firstChild || line,
        0
      );
    }, index);
    const field = page.getByLabel('Letter spacing (pt)');
    await field.fill(tracking);
    await field.press('Enter');
    await expect(editor).toBeFocused();
    expect(
      await editor.evaluate(() => {
        const s = getSelection(),
          node = s.anchorNode;
        return [
          (node.nodeType === 3 ? node.parentElement : node).closest(
            '[data-paragraph]'
          )?.dataset.paragraph,
          s.anchorOffset,
        ];
      })
    ).toEqual([String(index), 0]);
  }
});

test('Typing into a decorated empty paragraph highlights just the live glyph', async ({
  page,
}) => {
  page = await openRichText(page);
  const frame = page.locator('.artboard .item[data-id]').first();
  const row = frame.locator('[data-paragraph="1"]');
  await expect(row).toHaveText('');
  await row.dblclick({ force: true });
  await expect(page.getByRole('textbox', { name: 'Slide text' })).toBeFocused();
  const paint = () =>
    row.evaluate((line) => {
      const decorated = [...line.querySelectorAll('span')].find(
        (n) => getComputedStyle(n).backgroundColor === 'rgb(38, 56, 128)'
      );
      return {
        background: getComputedStyle(line).backgroundColor,
        text: decorated?.textContent || '',
        color: decorated && getComputedStyle(decorated).color,
        width: decorated?.getBoundingClientRect().width || 0,
        underlined: decorated?.style.textDecorationLine === 'underline',
      };
    });
  expect(await paint()).toMatchObject({
    background: 'rgba(0, 0, 0, 0)',
    width: 0,
  });
  await page.keyboard.insertText('字');
  const glyph = await paint();
  expect(glyph).toMatchObject({
    text: '字',
    color: 'rgb(255, 255, 255)',
    underlined: true,
    background: 'rgba(0, 0, 0, 0)',
  });
  expect(glyph.width).toBeGreaterThan(0);
  expect(glyph.width).toBeLessThan((await row.boundingBox()).width / 2);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await paint()).toMatchObject({ text: '', width: 0 });
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await paint()).toMatchObject({ text: '字', underlined: true });
  await page.keyboard.press('ControlOrMeta+Enter');
  expect(await paint()).toMatchObject({ text: '字', underlined: true });
});

test('Edits at different positions keep the original PowerPoint run boundaries and fonts', async ({
  page,
}, info) => {
  page = await openRichText(page);
  const frame = page.locator('.artboard .item[data-id]').first();
  await frame.dblclick();
  const editor = page.getByRole('textbox', { name: 'Slide text' });
  const runs = editor.locator('[data-paragraph="0"] span');
  for (const [i, character] of [
    [0, 'A'],
    [1, 'B'],
  ]) {
    await runs
      .nth(i)
      .evaluate((span) => getSelection().collapse(span.firstChild, 2));
    await page.keyboard.insertText(character);
  }
  await editor.press('ControlOrMeta+Enter');
  await expect(frame.locator('[data-paragraph="0"] span')).toHaveText([
    'LiAght',
    'SmBall',
  ]);
  const download = page.waitForEvent('download');
  await page.locator('.p-menu').click();
  await page.locator('.menu [data-action=saveAs]').click();
  const path = info.outputPath('edits.pptx');
  await (await download).saveAs(path);
  const xml = strFromU8(
    unzipSync(await readFile(path))['ppt/slides/slide1.xml']
  );
  const saved = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const p = doc.getElementsByTagNameNS('*', 'p')[0];
    return [...p.getElementsByTagNameNS('*', 'r')].map((r) => [
      r.textContent,
      r.getElementsByTagNameNS('*', 'rPr')[0].getAttribute('sz'),
    ]);
  }, xml);
  expect(saved).toEqual([
    ['LiAght', '1200'],
    ['SmBall', '900'],
  ]);
});
