import { test, expect } from '@playwright/test';

test('DrawingML script fonts, kerning and empty paragraph metrics survive editing and saving', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { blankDeck, textItem } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const { importDeck } = await import('/src/import.js');
    const { itemNode } = await import('/src/view.js');
    const { updateText } = await import('/src/text.js');
    const { pdfDocument } = await import('/src/document.js');
    const { parse, desc, child, children, attr } = await import('/src/xml.js');
    const d = blankDeck();
    d.slides[0].items = [textItem('Seed', 0, 0, 240, 160, 24)];
    const parts = exportDeck(d),
      path = 'ppt/slides/slide1.xml';
    parts.xml[path] = parts.xml[path].replace(
      /<a:lstStyle\/>[\s\S]*?<\/p:txBody>/,
      '<a:lstStyle><a:defPPr><a:defRPr lang="en-US" altLang="ja-JP" sz="2000" kern="2400"><a:latin typeface="Menlo"/></a:defRPr></a:defPPr></a:lstStyle>' +
        '<a:p><a:r><a:rPr u="sng"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:highlight><a:srgbClr val="000000"/></a:highlight><a:ea typeface="+mj-ea"/></a:rPr><a:t>A𠮷󠄀あ</a:t></a:r></a:p>' +
        '<a:p><a:endParaRPr sz="600" b="1" lang="ja-JP" kern="0"><a:highlight><a:schemeClr val="accent1"><a:alpha val="50000"/></a:schemeClr></a:highlight><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:endParaRPr></a:p></p:txBody>'
    );
    const themePath = 'ppt/theme/theme1.xml';
    parts.xml[themePath] = parts.xml[themePath]
      .replace('<a:ea typeface="Hiragino Sans"/>', '<a:ea typeface=""/>')
      .replace(
        '</a:majorFont>',
        '<a:font script="Jpan" typeface="Japanese Title"/></a:majorFont>'
      );
    const opened = importDeck(parts);
    const base = { ...opened, parts, deck: structuredClone(opened.deck) };
    const object = opened.deck.slides[0].items[0];
    const body = itemNode(object, {}, true);
    const spans = [...body.querySelectorAll('[data-paragraph="0"] span')].map(
      (span) => ({
        text: span.textContent,
        face: span.style.fontFamily,
        lang: span.lang,
        kern: span.style.fontKerning,
        highlight: span.style.backgroundColor,
        underline: span.style.textDecorationLine,
        index: span.dataset.runIndex,
      })
    );
    updateText(object, object.text + '追記');
    const change = exportDeck(opened.deck, base);
    const reopened = importDeck({
      xml: { ...parts.xml, ...change.xml },
      media: {},
    });
    const second = reopened.deck.slides[0].items[0].paragraphs[1].runs[0];
    const last = children(desc(parse(change.xml[path]), 'txBody'), 'p')[1];
    const rp = child(child(last, 'r'), 'rPr');
    const copy = blankDeck();
    copy.slides[0].items.push(structuredClone(object));
    const copied = importDeck(exportDeck(copy)).deck.slides[0].items[0];
    const pdf = await pdfDocument(reopened.deck, {});
    return {
      spans,
      empty: [object.paragraphs[1].base.size, object.paragraphs[1].base.bold],
      reopened: [
        second.text,
        second.size,
        second.bold,
        second.eastAsianFont,
        second.kern,
      ],
      originalThemeReferences: [
        attr(child(rp, 'latin'), 'typeface'),
        attr(child(rp, 'ea'), 'typeface'),
      ],
      originalHighlight: attr(
        child(child(rp, 'highlight'), 'schemeClr'),
        'val'
      ),
      copyHighlight: copied.paragraphs.map((p) => p.runs[0].highlight),
      copyUnderline: copied.paragraphs[0].runs[0].underline,
      blankBackground: body.querySelector('[data-paragraph="1"]').style
        .backgroundColor,
      printed:
        pdf.html.includes('background-color: rgb(0, 0, 0)') &&
        pdf.html.includes('text-decoration-line: underline'),
    };
  });
  expect(result.spans).toHaveLength(2);
  expect(result.spans[0]).toMatchObject({
    text: 'A',
    lang: 'en-US',
    kern: 'none',
    highlight: 'rgb(0, 0, 0)',
    underline: 'underline',
    index: '0',
  });
  expect(result.spans[0].face).toContain('Menlo');
  expect(result.spans[1]).toMatchObject({
    text: '𠮷󠄀あ',
    lang: 'ja-JP',
    kern: 'none',
    index: '0',
  });
  expect(result.spans[1].face).toContain('Japanese');
  expect(result.empty).toEqual([6, true]);
  expect(result.reopened).toEqual(['追記', 6, true, 'Hiragino Sans', 0]);
  expect(result.originalThemeReferences).toEqual(['+mn-lt', '+mn-ea']);
  expect(result.originalHighlight).toBe('accent1');
  expect(result.copyHighlight).toEqual(['#000000', '#354AE880']);
  expect(result.copyUnderline).toBe('sng');
  expect(result.blankBackground).toBe('');
  expect(result.printed).toBe(true);
});

test('Office family aliases resolve by weight while exact face names retain their style', async ({
  page,
}) => {
  await page.goto('/');
  const resolved = await page.evaluate(async () => {
    const { resolveTypeface } = await import('/src/platform.js');
    const { fontCSS } = await import('/src/view.js');
    const faces = [
      {
        family: 'Yu Gothic',
        full: 'Yu Gothic Light',
        postscript: 'YuGothic-Light',
        aliases: ['游ゴシック', '游ゴシック Light'],
        weight: -0.4,
      },
      {
        family: 'Yu Gothic',
        full: 'Yu Gothic Regular',
        postscript: 'YuGothic-Regular',
        aliases: ['游ゴシック'],
        weight: 0,
      },
      {
        family: 'Yu Gothic',
        full: 'Yu Gothic Bold',
        postscript: 'YuGothic-Bold',
        aliases: ['游ゴシック'],
        weight: 0.4,
        bold: true,
      },
    ];
    const choose = (name, bold) =>
      resolveTypeface(name, faces, bold)?.postscript;
    return [
      choose('游ゴシック'),
      choose('游ゴシック', true),
      choose('yu gothic light'),
      choose('YuGothic-Light'),
      choose('Unavailable face') ?? null,
      fontCSS('Missing', '游ゴシック'),
    ];
  });
  expect(resolved).toEqual([
    'YuGothic-Regular',
    'YuGothic-Bold',
    'YuGothic-Light',
    'YuGothic-Light',
    null,
    '"pp-Missing", "Missing", "pp-游ゴシック", "游ゴシック", sans-serif',
  ]);
});

test('Japanese fallback follows the declared charset and keeps the source font on copy', async ({
  page,
}) => {
  await page.goto('/');
  const evidence = await page.evaluate(async () => {
    const { importDeck } = await import('/src/import.js');
    const { exportDeck } = await import('/src/export.js');
    const { itemNode } = await import('/src/view.js');
    const { japaneseSubstitute } = await import('/src/text-runs.js');
    const { blankDeck, textItem } = await import('/src/model.js');
    const d = blankDeck(),
      name = 'QA Office Face';
    const object = textItem('日A', 3, 3, 140, 40, 16, { font: name });
    d.slides[0].items = [object];
    const base = exportDeck(d),
      path = 'ppt/slides/slide1.xml';
    function read(xml) {
      const opened = importDeck({ xml, media: {} });
      const obj = opened.deck.slides[0].items[0],
        run = obj.paragraphs[0].runs[0];
      const drawn = itemNode(obj, {}, true);
      const inline = [...drawn.querySelectorAll('[data-run-index]')];
      return {
        obj,
        css: inline[0].style.fontFamily,
        text: inline.map((s) => s.textContent).join(''),
        indexes: [...new Set(inline.map((s) => s.dataset.runIndex))],
        east: japaneseSubstitute(run, true) || null,
        latin: japaneseSubstitute(run) || null,
      };
    }
    const results = [];
    for (const charset of ['', '-128', '128']) {
      const xml = { ...base.xml };
      if (charset)
        xml[path] = xml[path].replaceAll(
          'typeface="' + name + '"',
          'typeface="' + name + '" charset="' + charset + '"'
        );
      const original = read(xml);
      const copy = blankDeck();
      copy.slides[0].items = [structuredClone(original.obj)];
      const output = exportDeck(copy);
      const reopened = read(output.xml);
      results.push({
        east: original.east,
        latin: original.latin,
        css: original.css,
        kept:
          original.east === reopened.east &&
          original.latin === reopened.latin &&
          reopened.obj.paragraphs[0].runs[0].eastAsianCharset === charset,
        onlySourceFont: !/typeface="(?:MS Gothic|Yu Gothic|Calibri)"/.test(
          output.xml[path]
        ),
        indexes: reopened.indexes,
        text: reopened.text,
      });
    }
    const chinese = read({
      ...base.xml,
      [path]: base.xml[path].replaceAll('lang="ja-JP"', 'lang="zh-CN"'),
    });
    return { results, chinese: [chinese.east, chinese.latin] };
  });
  expect(evidence.chinese).toEqual([null, null]);
  for (const [i, result] of evidence.results.entries()) {
    expect(result).toMatchObject({
      east: i ? 'Yu Gothic' : 'MS Gothic',
      latin: i ? 'Yu Gothic' : 'Calibri',
      kept: true,
      onlySourceFont: true,
      indexes: ['0'],
      text: '日A',
    });
    expect(result.css.indexOf('QA Office Face')).toBeLessThan(
      result.css.indexOf(result.east)
    );
  }
});
