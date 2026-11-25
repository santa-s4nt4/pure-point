import { expect, test } from '@playwright/test';

test('POTX becomes a new presentation and PowerPoint review metadata survives repeated edits', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { exportDeck } = await import('/src/export.js');
    const { importDeck } = await import('/src/import.js');
    const { blankDeck, slide } = await import('/src/model.js');
    const template = exportDeck(blankDeck());
    template.xml['[Content_Types].xml'] = template.xml[
      '[Content_Types].xml'
    ].replace(
      'presentationml.presentation.main+xml',
      'presentationml.template.main+xml'
    );
    const source = importDeck(template);
    const base = {
      ...source,
      parts: template,
      deck: structuredClone(source.deck),
    };
    const pristine = exportDeck(source.deck, base);
    const deck = source.deck;
    const section = { id: crypto.randomUUID(), name: 'Review & approval' };
    const comment = {
      id: crypto.randomUUID(),
      author: 'Slide editor',
      text: 'Please check <this>.',
      x: 45.5,
      y: 70,
      createdAt: '2026-01-01T00:00:00Z',
    };
    deck.sections = [section];
    deck.slides[0].sectionId = section.id;
    deck.slides[0].comments = [comment];
    const second = slide('Second');
    second.sectionId = section.id;
    second.hidden = true;
    deck.slides.push(second);
    const changed = exportDeck(deck, base);
    const parts = { xml: { ...template.xml, ...changed.xml }, media: {} };
    const reopened = importDeck(parts),
      secondBase = { ...reopened, parts, deck: structuredClone(reopened.deck) };
    const originalComment = reopened.deck.slides[0].comments[0];
    const noop = exportDeck(reopened.deck, secondBase);
    reopened.deck.slides[0].comments[0].text = 'Checked';
    reopened.deck.slides[1].hidden = false;
    const edited = exportDeck(reopened.deck, secondBase);
    const final = importDeck({
      xml: { ...parts.xml, ...edited.xml },
      media: {},
    });
    return {
      pristine: Object.keys(pristine.xml),
      converted: pristine.xml['[Content_Types].xml'].includes(
        'presentationml.presentation.main+xml'
      ),
      originalTemplate: template.xml['[Content_Types].xml'].includes(
        'presentationml.template.main+xml'
      ),
      section: final.deck.sections[0].name,
      member: final.deck.slides.every((s) => s.sectionId === section.id),
      wasHidden: secondBase.deck.slides[1].hidden,
      nowHidden: final.deck.slides[1].hidden,
      original: secondBase.deck.slides[0].comments[0].text,
      updated: final.deck.slides[0].comments[0].text,
      anchor: [originalComment.x, originalComment.y],
      author: originalComment.author,
      noop: Object.keys(noop.xml),
      reviewParts: Object.keys(parts.xml).filter((p) =>
        p.includes('modernComment')
      ),
    };
  });
  expect(result).toMatchObject({
    pristine: ['[Content_Types].xml'],
    converted: true,
    originalTemplate: true,
    section: 'Review & approval',
    member: true,
    wasHidden: true,
    nowHidden: false,
    original: 'Please check <this>.',
    updated: 'Checked',
    anchor: [45.5, 70],
    author: 'Slide editor',
    noop: [],
  });
  expect(result.reviewParts).toHaveLength(1);
});

test('PDF uses the current slide contents and omits hidden slides and editor controls', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { pdfDocument } = await import('/src/document.js'),
      { slide, textItem } = await import('/src/model.js');
    const hidden = slide('Hidden', '#ffffff', [
      textItem('Do not print', 1, 2, 30, 40, 12),
    ]);
    hidden.hidden = true;
    const visible = slide('Visible', '#abcdef', [
      textItem('Printed on the page', 1, 2, 300, 80, 24),
    ]);
    const pdf = await pdfDocument(
      { w: 960, h: 540, slides: [hidden, visible] },
      {}
    );
    const doc = new DOMParser().parseFromString(pdf.html, 'text/html');
    return {
      size: [pdf.width, pdf.height],
      count: pdf.count,
      text: doc.body.textContent,
      interactive: doc.querySelectorAll('button,video,iframe,input').length,
    };
  });
  expect(result).toEqual({
    size: [960, 540],
    count: 1,
    text: 'Printed on the page',
    interactive: 0,
  });
});

test('Disk-backed pictures and video posters reach the canvas, print pages and PPTX writer by reference', async ({
  page,
}) => {
  await page.route('**/media-fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<body></body>' })
  );
  await page.goto('/media-fixture');
  const result = await page.evaluate(async () => {
    window.isTauri = true;
    const { scene } = await import('/src/view.js');
    const { pdfDocument } = await import('/src/document.js');
    const { exportDeck } = await import('/src/export.js');
    const { blankDeck, shape } = await import('/src/model.js');
    const deck = blankDeck();
    const picture = 'ppt/media/picture.png',
      movie = 'ppt/media/movie.mp4';
    const origin = 'http://127.0.0.1:30475';
    const assets = {
      [picture]: {
        token: 'picture',
        mime: 'image/png',
        url: origin + '/picture',
      },
      [movie]: { token: 'movie', mime: 'video/mp4', url: origin + '/movie' },
    };
    const slide = deck.slides[0];
    slide.items.push(
      shape('image', 'Image', 10, 20, 100, 100, { asset: picture }),
      shape('video', 'Movie', 120, 20, 200, 100, {
        asset: movie,
        poster: picture,
      })
    );
    const editing = scene(slide, deck, assets, true);
    const preview = scene(slide, deck, assets);
    const urls = (node) => [...node.querySelectorAll('img')].map((i) => i.src);
    const { html } = await pdfDocument(deck, assets);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const changes = exportDeck(deck, null, assets);
    return {
      canvas: urls(editing),
      poster: editing.querySelector('video').poster,
      preview: urls(preview),
      print: [...doc.images].map((i) => [
        i.hasAttribute('src'),
        i.dataset.printSrc,
      ]),
      policy: doc.querySelector('[http-equiv]').content,
      media: changes.media,
      files: changes.videoFiles,
    };
  });
  const imageURL = 'http://127.0.0.1:30475/picture';
  expect(result).toMatchObject({
    canvas: [imageURL, imageURL],
    poster: imageURL,
    preview: [imageURL, imageURL],
    print: [
      [false, imageURL],
      [false, imageURL],
    ],
    media: {},
    files: {
      'ppt/media/picture.png': 'picture',
      'ppt/media/movie.mp4': 'movie',
    },
  });
  expect(result.policy).toContain(
    'img-src data: blob: http://127.0.0.1:30475;'
  );
});
