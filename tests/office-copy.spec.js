import { expect, test } from '@playwright/test';

test('Pasted PowerPoint tables and charts retain native XML, new shape IDs and source relationships', async ({
  page,
}) => {
  await page.goto('/icon.png');
  const result = await page.evaluate(async () => {
    const { blankDeck, slide } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const { importDeck, relationships } = await import('/src/import.js');
    const { copiesOnSlide } = await import('/src/layers.js');
    const { captureOfficeObject, validateOfficeCopies } =
      await import('/src/office-copy.js');
    const { parse, desc, attr, children, R, relfile } =
      await import('/src/xml.js');
    const deck = blankDeck();
    deck.slides.push(slide());
    const parts = exportDeck(deck),
      p1 = 'ppt/slides/slide1.xml',
      p2 = 'ppt/slides/slide2.xml';
    const chartNS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
    const chart = (id, name) =>
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="127000" y="254000"/><a:ext cx="1270000" cy="762000"/></p:xfrm><a:graphic><a:graphicData uri="${chartNS}"><c:chart xmlns:c="${chartNS}" r:id="rId8"/></a:graphicData></a:graphic></p:graphicFrame>`;
    const table = chart(3, 'Table').replace(
      /<a:graphicData[\s\S]*?<\/a:graphicData>/,
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="1270000"/></a:tblGrid><a:tr h="762000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Revenue</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData>'
    );
    parts.xml[p1] = parts.xml[p1].replace(
      '</p:spTree>',
      chart(2, 'Chart') + table + '</p:spTree>'
    );
    parts.xml[p2] = parts.xml[p2].replace(
      '</p:spTree>',
      chart(7, 'Other chart') + '</p:spTree>'
    );
    for (const [p, path] of [
      [p1, 'chart1'],
      [p2, 'chart2'],
    ]) {
      parts.xml[relfile(p)] = parts.xml[relfile(p)].replace(
        '</Relationships>',
        `<Relationship Id="rId8" Type="${R}/chart" Target="../charts/${path}.xml"/></Relationships>`
      );
      parts.xml['ppt/charts/' + path + '.xml'] =
        `<c:chartSpace xmlns:c="${chartNS}"/>`;
    }
    const loaded = importDeck(parts),
      base = { ...loaded, parts, deck: structuredClone(loaded.deck) };
    const [source, dest] = loaded.deck.slides;
    const copies = copiesOnSlide(
      source.items,
      source.items.map((o) => o.id),
      (o) => captureOfficeObject(o, source, base)
    );
    for (const c of copies) {
      c.id = crypto.randomUUID();
      c.x += 32;
      c.rotation = 13;
    }
    validateOfficeCopies(copies, base);
    let rejected = false;
    try {
      validateOfficeCopies(copies, null);
    } catch {
      rejected = true;
    }
    dest.items.push(...copies);
    const patch = exportDeck(loaded.deck, base);
    const merged = { xml: { ...parts.xml, ...patch.xml }, media: {} },
      reopened = importDeck(merged);
    const xml = parse(merged.xml[p2]);
    const frames = children(desc(xml, 'spTree'), 'graphicFrame');
    const rel = relationships(merged.xml, p2);
    const destinations = frames
      .slice(0, 2)
      .map(
        (n) =>
          rel.find((r) => r.id === desc(n, 'chart').getAttributeNS(R, 'id'))
            .target
      );
    const other = blankDeck();
    other.slides[0].items = [copies[1]];
    validateOfficeCopies(other.slides[0].items, null);
    return {
      destinations,
      indices: frames.map((n) => attr(desc(n, 'cNvPr'), 'id')),
      rejected,
      sourceUnaffected: !patch.xml[p1],
      kinds: reopened.deck.slides[1].items.map((o) => o.kind),
      x: reopened.deck.slides[1].items[1].x,
      rotation: reopened.deck.slides[1].items[1].rotation,
      tableReopened: importDeck(exportDeck(other)).deck.slides[0].items[0].table
        .rows[0].cells[0].paragraphs[0].runs[0].text,
    };
  });
  expect(result).toEqual({
    destinations: ['ppt/charts/chart2.xml', 'ppt/charts/chart1.xml'],
    indices: ['7', '8', '9'],
    rejected: true,
    sourceUnaffected: true,
    kinds: ['unsupported', 'unsupported', 'table'],
    x: 42,
    rotation: 13,
    tableReopened: 'Revenue',
  });
});
