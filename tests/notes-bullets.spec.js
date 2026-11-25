import { test, expect } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';

test('Empty content places the caret at the body indent, and Enter continues or finishes its native list', async ({
  page,
}, info) => {
  await page.goto('/');
  await page.locator('.rail [data-action=addSlide]').click();
  await page
    .getByRole('button', { name: 'title and content', exact: true })
    .click();
  const frame = page.locator('.artboard [data-id]').last(),
    box = await frame.boundingBox();
  await frame.dblclick({
    position: { x: box.width * 0.5, y: box.height * 0.5 },
  });
  const input = page.getByRole('textbox', { name: 'Slide text' });
  const caret = await input.evaluate((n) => {
    const li = n.querySelector('li'),
      s = getSelection(),
      scale = n.getBoundingClientRect().width / n.offsetWidth;
    return {
      tag: s.anchorNode.nodeName,
      offset: s.anchorOffset,
      x: li.querySelector('br').getBoundingClientRect().x,
      gap:
        (li.querySelector('br').getBoundingClientRect().x -
          li.getBoundingClientRect().x) /
        scale,
      margin: parseFloat(getComputedStyle(li).paddingLeft),
    };
  });
  expect(caret.tag).toBe('LI');
  expect(caret.offset).toBe(0);
  expect(caret.gap).toBeCloseTo(caret.margin, 1);
  await page.keyboard.insertText('最初の項目');
  const x = await input.evaluate((n) => {
    const r = document.createRange();
    r.selectNodeContents(n.querySelector('li'));
    return r.getBoundingClientRect().x;
  });
  expect(x).toBeCloseTo(caret.x, 1);
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Second');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Plain paragraph');
  await input.press('Meta+Enter');
  await expect(frame.locator('li')).toHaveCount(2);
  const save = page.waitForEvent('download');
  await page.locator('.p-menu').click();
  await page.locator('.menu [data-action=saveAs]').click();
  const path = info.outputPath('bullet.pptx');
  await (await save).saveAs(path);
  const disk = unzipSync(await readFile(path));
  const flags = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const paragraphs = [...doc.getElementsByTagNameNS('*', 'sp')]
      .at(-1)
      .getElementsByTagNameNS('*', 'p');
    return [...paragraphs].map((p) => [
      p.getElementsByTagNameNS('*', 't')[0]?.textContent,
      p.getElementsByTagNameNS('*', 'buChar')[0]?.getAttribute('char') ||
        Boolean(p.getElementsByTagNameNS('*', 'buNone').length),
    ]);
  }, strFromU8(disk['ppt/slides/slide2.xml']));
  expect(flags).toEqual([
    ['最初の項目', false],
    ['Second', '•'],
    ['Plain paragraph', true],
  ]);
  const file = page.waitForEvent('filechooser');
  await page.locator('.p-menu').click();
  await page.locator('.menu [data-action=open]').click();
  await (await file).setFiles(path);
  await page.locator('.rail [data-slide="1"]').click();
  await expect(page.locator('.artboard li')).toHaveCount(2);
});

test('Dash-space is a real editable bullet with native undo, IME and wrapping', async ({
  page,
}) => {
  await page.goto('/');
  const board = page.locator('.artboard'),
    editor = page.getByRole('textbox', { name: 'Slide text' });
  await board.dblclick({ position: { x: 80, y: 80 } });
  await page.keyboard.type('- ');
  await expect(editor.locator('li')).toHaveCount(1);
  await editor.press('Meta+z');
  await expect(editor.locator('li')).toHaveCount(0);
  await expect(editor).toHaveText('-');
  await editor.press('Meta+Shift+z');
  await expect(editor.locator('li')).toHaveCount(1);
  await page.keyboard.insertText('項目');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');
  await expect(editor.locator('li')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('a-b c');
  await page.keyboard.press('Enter');
  await page.keyboard.type('-');
  await editor.dispatchEvent('compositionstart');
  const prevented = await editor.evaluate(
    (n) =>
      !n.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: ' ',
          bubbles: true,
          cancelable: true,
          isComposing: true,
        })
      )
  );
  expect(prevented).toBe(false);
  await editor.dispatchEvent('compositionend');
  await page.keyboard.type(' ');
  await expect(editor.locator('li')).toHaveCount(2);
  await page.keyboard.insertText('Last');
  await editor.press('Meta+Enter');
  await expect(board.locator('li')).toHaveText(['項目', 'Last']);
  await expect(board).toContainText('a-b c');
});

test('Speaker notes create native linked notes pages, reuse a master, and preserve authored notes markup', async ({
  page,
}) => {
  await page.goto('/');
  const check = await page.evaluate(async () => {
    const { blankDeck, slide } = await import('/src/model.js'),
      { importDeck, relationships } = await import('/src/import.js'),
      { exportDeck } = await import('/src/export.js');
    const {
      parse,
      serialize,
      desc,
      child,
      attr,
      children,
      ns,
      relfile,
      namespaceDialect,
    } = await import('/src/xml.js');
    const deck = blankDeck();
    deck.slides.push(slide('Second'));
    const noNotes = exportDeck(deck);
    deck.slides[0].notes = 'One & two\n複数行';
    const parts = exportDeck(deck);
    const slidePath = 'ppt/slides/slide1.xml';
    const target = (parts, path, type) =>
      relationships(parts.xml, path).find((r) => r.type === type)?.target;
    const note = target(parts, slidePath, 'notesSlide'),
      master = target(parts, note, 'notesMaster');
    const doc = parse(parts.xml[note]),
      body = desc(doc, 'txBody'),
      p0 = children(body, 'p')[0];
    p0.insertBefore(
      parse('<a:pPr ' + ns + ' lvl="2"/>').documentElement,
      p0.firstElementChild
    );
    const r = desc(p0, 'r');
    r.insertBefore(
      parse('<a:rPr ' + ns + ' b="1"/>').documentElement,
      r.firstElementChild
    );
    const extra = doc.importNode(
      parse(
        '<p:sp ' +
          ns +
          '><p:nvSpPr><p:cNvPr id="95" name="Footer"/><p:cNvSpPr/><p:nvPr><p:ph type="ftr" idx="9"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Custom footer</a:t></a:r></a:p></p:txBody></p:sp>'
      ).documentElement,
      true
    );
    desc(doc, 'spTree').append(extra);
    parts.xml[note] = serialize(doc);
    for (const [path, text] of Object.entries(parts.xml))
      parts.xml[path] = namespaceDialect(text, true);
    const first = importDeck(parts),
      base = { ...first, parts, deck: structuredClone(first.deck) };
    const original = first.deck.slides.map((s) => s.notes);
    first.deck.slides[0].notes = 'One & two!\n\n複数行';
    first.deck.slides[1].notes = 'Second slide';
    const changes = exportDeck(first.deck, base),
      next = { xml: { ...parts.xml, ...changes.xml }, media: {} };
    const second = target(next, 'ppt/slides/slide2.xml', 'notesSlide');
    const reopened = importDeck(next),
      base2 = {
        ...reopened,
        parts: next,
        deck: structuredClone(reopened.deck),
      };
    reopened.deck.slides[0].notes = '';
    const cleared = exportDeck(reopened.deck, base2);
    return {
      empty: Object.keys(noNotes.xml).some(
        (k) => k.includes('notesSlides') || k.includes('notesMasters')
      ),
      original,
      reading: base2.deck.slides.map((s) => s.notes),
      theme:
        !!target(next, master, 'theme') &&
        target(next, master, 'theme') !==
          target(
            next,
            target(next, 'ppt/presentation.xml', 'slideMaster'),
            'theme'
          ),
      masterUnchanged: !(master in changes.xml),
      sameMaster: target(next, second, 'notesMaster') === master,
      back: target(next, second, 'slide'),
      rich:
        changes.xml[note].includes('b="1"') &&
        changes.xml[note].includes('lvl="2"') &&
        changes.xml[note].includes('Custom footer'),
      strict: changes.xml[second].includes(
        'http://purl.oclc.org/ooxml/presentationml/main'
      ),
      cleared: importDeck({
        xml: { ...next.xml, ...cleared.xml },
        media: {},
      }).deck.slides.map((s) => s.notes),
      footer: cleared.xml[note].includes('Custom footer'),
    };
  });
  expect(check).toEqual({
    empty: false,
    original: ['One & two\n複数行', ''],
    reading: ['One & two!\n\n複数行', 'Second slide'],
    theme: true,
    masterUnchanged: true,
    sameMaster: true,
    back: 'ppt/slides/slide2.xml',
    rich: true,
    strict: true,
    cleared: ['', 'Second slide'],
    footer: true,
  });
});
