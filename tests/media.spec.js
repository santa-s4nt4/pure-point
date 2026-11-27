import { openFileWindow } from './document-window.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
const movie = fileURLToPath(
  new URL('./fixtures/two-seconds.mp4', import.meta.url)
);
const imagePath = fileURLToPath(
  new URL('./fixtures/image.png', import.meta.url)
);
const picture = {
  name: 'small.png',
  mimeType: 'image/png',
  buffer: await readFile(imagePath),
};

async function pick(page, action, file) {
  const dialog = page.waitForEvent('filechooser');
  await action();
  await (await dialog).setFiles(file);
}
async function menu(page, action) {
  await page.locator('[data-action="fileMenu"]').click();
  await page.locator('.menu [data-action="' + action + '"]').click();
}
async function exportFile(page, path) {
  const ready = page.waitForEvent('download');
  await menu(page, 'saveAs');
  await (await ready).saveAs(path);
  return unzipSync(await readFile(path));
}

test('local movies play, seek and survive PowerPoint save/open plus a dropped replacement', async ({
  page,
}, info) => {
  await page.goto('/');
  await pick(
    page,
    () => page.locator('[data-action="tool-video"]').click(),
    movie
  );
  let surface = page.locator('.artboard .video-surface');
  await expect(surface).toHaveCount(1);
  await surface.hover();
  await surface.getByRole('button', { name: 'Play video' }).click();
  await expect
    .poll(() => surface.locator('video').evaluate((n) => n.currentTime))
    .toBeGreaterThan(0);
  await surface.getByRole('button', { name: 'Pause video' }).click();
  const seek = surface.getByRole('slider', { name: 'Seek video' });
  await seek.fill('1.2');
  await expect
    .poll(() => surface.locator('video').evaluate((n) => n.currentTime))
    .toBeCloseTo(1.2, 1);
  await surface.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect
    .poll(() => surface.locator('video').evaluate((n) => n.muted))
    .toBe(true);
  const first = info.outputPath('movie.pptx'),
    parts = await exportFile(page, first);
  const file = Object.keys(parts).find((k) => k.endsWith('.mp4'));
  expect(Buffer.from(parts[file])).toEqual(await readFile(movie));
  const body = strFromU8(parts['ppt/slides/slide1.xml']);
  expect(body).toContain('ppaction://media');
  expect(body).toContain('<p:video>');
  expect(body).toContain('p14:media');
  const oldId = await surface.locator('..').getAttribute('data-id');
  page = await openFileWindow(page, first, () => menu(page, 'open'));
  surface = page.locator('.artboard .video-surface');
  await expect(surface.locator('..')).not.toHaveAttribute('data-id', oldId);
  const before = await surface.locator('..').boundingBox();
  const bytes = (await readFile(movie)).toString('base64');
  await surface.evaluate((n, bytes) => {
    const t = new DataTransfer();
    t.items.add(
      new File(
        [Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))],
        'replacement.mp4',
        { type: 'video/mp4' }
      )
    );
    n.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: t,
      })
    );
  }, bytes);
  await expect.poll(() => surface.locator('..').boundingBox()).toEqual(before);
  await expect
    .poll(() => page.locator('#status').textContent())
    .toMatch(/unsaved|changes|変更/i);
  const second = await exportFile(page, info.outputPath('replacement.pptx'));
  expect(strFromU8(second['ppt/slides/slide1.xml'])).toContain(
    'replacement.mp4'
  );
});

test('YouTube and Vimeo embeds use isolated provider frames and persist in PPTX', async ({
  page,
}, info) => {
  await page.goto('/');
  for (const [address, expected] of [
    [
      'https://youtu.be/M7lc1UVf-VE',
      'https://www.youtube.com/embed/M7lc1UVf-VE',
    ],
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871'],
  ]) {
    await page.locator('[data-action="tool-embed"]').click();
    await page.getByLabel('Video URL').fill(address);
    await page.getByRole('button', { name: 'Embed', exact: true }).click();
    const player = page.locator('.artboard .video-surface').last();
    await player.hover();
    await player.getByRole('button', { name: /Play .* video/ }).click();
    await expect(player.locator('iframe')).toHaveAttribute(
      'src',
      expected + '?autoplay=1'
    );
    await player.getByRole('button', { name: 'Close player' }).click();
  }
  const parts = await exportFile(page, info.outputPath('embeds.pptx'));
  const relationships = strFromU8(parts['ppt/slides/_rels/slide1.xml.rels']);
  expect(relationships).toContain('https://www.youtube.com/embed/M7lc1UVf-VE');
  expect(relationships).toContain('https://player.vimeo.com/video/76979871');
  expect(relationships).toContain('TargetMode="External"');
});

test('Crop an imported image, reopen the crop, and replace its source through Design', async ({
  page,
}, info) => {
  await page.goto('/');
  await pick(
    page,
    () => page.locator('[data-action="tool-image"]').click(),
    picture
  );
  const imageFrame = () =>
    page.locator('.artboard .item:has(.image-clip)').first();
  let frame = imageFrame();
  const first = info.outputPath('first-image.pptx');
  await exportFile(page, first);
  const oldId = await frame.getAttribute('data-id');
  page = await openFileWindow(page, first, () => menu(page, 'open'));
  frame = imageFrame();
  await expect(frame).not.toHaveAttribute('data-id', oldId);
  const originalBox = await frame.boundingBox();
  await frame.click();
  await page.getByRole('button', { name: 'Crop image…' }).click();
  const crop = page
    .locator('.artboard')
    .getByRole('group', { name: 'Crop image' });
  const leftEdge = crop.getByRole('button', { name: 'Crop left', exact: true });
  const handle = await leftEdge.boundingBox();
  const cropBox = await crop.boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + cropBox.width / 4,
    handle.y + handle.height / 2,
    { steps: 4 }
  );
  await page.mouse.up();
  await page.locator('.artboard').click({ position: { x: 20, y: 20 } });
  await expect(crop).toHaveCount(0);
  await expect
    .poll(async () => (await frame.boundingBox()).width)
    .toBeLessThan(originalBox.width);
  const croppedBox = await frame.boundingBox();
  expect(croppedBox.width / originalBox.width).toBeCloseTo(0.75, 2);
  expect(croppedBox.x + croppedBox.width).toBeCloseTo(
    originalBox.x + originalBox.width,
    1
  );
  await page.keyboard.press('ControlOrMeta+z');
  expect(await frame.boundingBox()).toEqual(originalBox);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  const cropped = info.outputPath('cropped-image.pptx');
  const parts = await exportFile(page, cropped);
  const savedCrop = strFromU8(parts['ppt/slides/slide1.xml']).match(
    /<a:srcRect l="(\d+)"/
  );
  expect(Number(savedCrop[1]) / 100000).toBeCloseTo(0.25, 2);
  page = await openFileWindow(page, cropped, () => menu(page, 'open'));
  frame = imageFrame();
  await frame.dblclick();
  await page.getByRole('button', { name: 'Reset crop' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await frame.boundingBox()).width).toBeCloseTo(croppedBox.width, 1);
  await frame.click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Replace image…' })
  ).toBeVisible();
  await page.getByRole('menuitem', { name: 'Crop image…' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await pick(
    page,
    () => page.locator('#properties [data-action=replaceMedia]').click(),
    {
      ...picture,
      name: 'replacement.png',
    }
  );
  await expect
    .poll(() => page.locator('#status').textContent())
    .toMatch(/unsaved|changes|変更/i);
  expect((await frame.boundingBox()).width).toBeCloseTo(croppedBox.width, 1);
  const second = await exportFile(page, info.outputPath('second-image.pptx'));
  expect(strFromU8(second['ppt/slides/slide1.xml'])).not.toContain('srcRect');
  expect(strFromU8(second['ppt/slides/slide1.xml'])).toContain(
    'replacement.png'
  );
});

test('Copying grouped media retains the movie until the last document closes and reuses matching PPTX parts', async ({
  page,
}) => {
  await page.route('**/clipboard-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="en"></html>',
    })
  );
  await page.goto('/clipboard-fixture');
  const result = await page.evaluate(async () => {
    const released = [];
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      invoke: (cmd, { tokens }) => {
        if (cmd === 'release_movies') released.push(...tokens);
        return Promise.resolve();
      },
    };
    const {
      captureClipboardMedia: capture,
      pasteClipboardMedia: paste,
      releaseClipboardMedia: discard,
    } = await import('/src/clipboard-media.js');
    const { releaseMovies } = await import('/src/platform.js');
    const picture = 'ppt/media/image1.png',
      movie = 'ppt/media/movie1.mp4';
    const source = {
      [picture]: {
        token: 'picture-fixture',
        url: 'http://127.0.0.1/picture-fixture',
        mime: 'image/png',
      },
      [movie]: {
        token: 'fixture',
        url: 'http://127.0.0.1/fixture',
        mime: 'video/mp4',
      },
    };
    const destination = { [picture]: 'data:image/png;base64,Yg==' };
    const items = [
      {
        kind: 'group',
        items: [
          { kind: 'image', asset: picture },
          { kind: 'video', poster: picture, asset: movie },
        ],
      },
    ];
    const clip = capture(items, source);
    const same = structuredClone(items);
    paste(same, clip, source);
    await releaseMovies(Object.values(source));
    const copies = [];
    for (let i = 0; i < 20; i++) {
      const copy = structuredClone(items);
      paste(copy, clip, destination);
      copies.push(copy[0].items);
    }
    await discard(clip);
    await discard(clip);
    const beforeClose = [...released];
    await releaseMovies(Object.values(destination));
    return {
      same: same[0].items[1].asset === movie,
      paths: Object.keys(destination).length,
      movies: new Set(copies.map((a) => a[1].asset)).size,
      noCollision: copies.every(
        (a) => a[0].asset !== picture && a[1].poster === a[0].asset
      ),
      beforeClose,
      released,
    };
  });
  expect(result).toEqual({
    same: true,
    paths: 3,
    movies: 1,
    noCollision: true,
    beforeClose: [],
    released: ['picture-fixture', 'fixture'],
  });
});

test('Slide copies keep cropped media and comment anchors after the original is removed', async ({
  page,
}) => {
  await page.goto('/icon.png');
  const results = await page.evaluate(async (png) => {
    const { shape, blankDeck } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const { importDeck } = await import('/src/import.js');
    const { captureSlides, pasteSlides } =
      await import('/src/slide-clipboard.js');
    const asset = 'ppt/media/source.png';
    const assets = { [asset]: 'data:image/png;base64,' + png };
    const fixture = blankDeck();
    const picture = shape('image', 'Cropped picture', 60, 30, 50, 50, {
      asset,
      crop: [0.15, 0.1, 0.35, 0],
      fill: '#F2F2F2',
      pictureEffects: [{ bright: 0.7, contrast: -0.7 }, { alpha: 0.75 }],
    });
    const source = fixture.slides[0];
    source.items.push(picture);
    source.comments = [
      {
        id: crypto.randomUUID(),
        text: 'Image note',
        author: 'Reader',
        createdAt: new Date().toISOString(),
        objectId: picture.id,
        x: 61,
        y: 32,
        offsetX: 1,
        offsetY: 2,
      },
    ];
    const parts = exportDeck(fixture, null, assets);
    parts.media = assets;
    const file = importDeck(parts);
    const base = { ...file, parts, deck: structuredClone(file.deck) };
    const original = file.deck.slides[0];
    const clip = captureSlides(
      file.deck,
      new Set([original.id]),
      base,
      assets,
      'source'
    );
    const dest = blankDeck();
    return ['source', 'destination'].map((documentId) => {
      const local = documentId === 'source';
      const destAssets = local ? assets : {};
      const deck = local ? file.deck : dest;
      deck.slides = pasteSlides(
        clip,
        local ? base : null,
        destAssets,
        documentId,
        null
      );
      const edit = exportDeck(deck, local ? base : null, destAssets);
      const xml = { ...(local ? parts.xml : {}), ...edit.xml };
      for (const path of edit.removed || []) delete xml[path];
      const reopened = importDeck({ xml, media: destAssets }).deck.slides[0];
      const image = reopened.items[0];
      return {
        crop: image.crop,
        fill: image.fill,
        effects: image.pictureEffects,
        matches: destAssets[image.asset] === assets[asset],
        independent: reopened.comments[0].id !== original.comments[0].id,
        anchored: reopened.comments[0].objectId === image.id,
      };
    });
  }, picture.buffer.toString('base64'));
  for (const result of results)
    expect(result).toEqual({
      crop: [0.15, 0.1, 0.35, 0],
      fill: '#F2F2F2',
      effects: [{ bright: 0.7, contrast: -0.7 }, { alpha: 0.75 }],
      matches: true,
      independent: true,
      anchored: true,
    });
});

test('DrawingML picture effects change the pixels while leaving the frame fill visible', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { shape } = await import('/src/model.js');
    const { itemNode } = await import('/src/view.js');
    const { readPictureEffects } = await import('/src/picture-effects.js');
    const { parse, ns } = await import('/src/xml.js');
    const bitmap = document.createElement('canvas');
    bitmap.width = 20;
    bitmap.height = 20;
    bitmap.getContext('2d').fillRect(0, 0, 10, 20);
    const assets = { picture: bitmap.toDataURL() };
    const sample = document.createElement('div');
    sample.id = 'picture-probe';
    sample.style.cssText =
      'position:fixed;top:0;left:0;width:40px;height:20px;z-index:9999;background:white';
    [
      '<a:alphaModFix amt="10%"/>',
      '<a:lum bright="70000" contrast="-70000"/><a:alphaModFix/>',
    ].forEach((markup, i) => {
      const o = shape('image', 'Probe', i * 20, 0, 20, 20, {
        asset: 'picture', fill: i ? '#FF0000' : '#FFFFFF',
      });
      const blip = parse('<a:blip ' + ns + '>' + markup + '</a:blip>').documentElement;
      readPictureEffects(blip, o);
      sample.append(itemNode(o, assets));
    });
    document.body.append(sample);
    await Promise.all(
      [...sample.querySelectorAll('img')].map((img) => img.decode())
    );
  });
  const shot = await page.locator('#picture-probe').screenshot();
  const pixels = await page.evaluate(async (base64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + base64;
    await img.decode();
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.drawImage(img, 0, 0, 40, 20);
    return [5, 15, 25, 35].map((x) =>
      [...ctx.getImageData(x, 10, 1, 1).data].slice(0, 3)
    );
  }, shot.toString('base64'));
  // Black at 10% over white, untouched white, Office washout, transparent over red.
  // Windows and macOS compositors can differ by two 8-bit levels on filtered pixels.
  for (const [index, expected] of [[0, 230], [2, 205]])
    for (const channel of pixels[index])
      expect(Math.abs(channel - expected)).toBeLessThanOrEqual(2);
  expect(pixels[1]).toEqual([255, 255, 255]);
  expect(pixels[3]).toEqual([255, 0, 0]);
});

test('PowerPoint SVG pictures resolve extension-only and dual embeds and survive copying and replacement', async ({
  page,
}) => {
  await page.goto('/icon.png');
  const result = await page.evaluate(async (png) => {
    const { blankDeck, shape } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const { importDeck } = await import('/src/import.js');
    const { itemNode } = await import('/src/view.js');
    const { captureClipboardMedia, pasteClipboardMedia } =
      await import('/src/clipboard-media.js');
    const { parse, R, serialize, relfile, PKG } = await import('/src/xml.js');
    const bitmap = 'ppt/media/preview.png',
      svg = 'ppt/media/drawing.svg';
    const media = {
      [bitmap]: 'data:image/png;base64,' + png,
      [svg]:
        'data:image/svg+xml;base64,' +
        btoa(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><path fill="red" d="M0 0h40v20H0z"/></svg>'
        ),
    };
    const deck = blankDeck();
    deck.slides[0].items = [0, 1, 2].map((i) =>
      shape('image', 'Picture ' + i, i * 100, 15, 80, 40, {
        asset: bitmap,
        crop: [0.15, 0, 0, 0],
      })
    );
    const parts = exportDeck(deck, null, media);
    parts.media = { ...media };
    const path = 'ppt/slides/slide1.xml',
      rels = relfile(path);
    const relDoc = parse(parts.xml[rels]);
    const relation = relDoc.createElementNS(PKG, 'Relationship');
    relation.setAttribute('Id', 'rIdSVG');
    relation.setAttribute('Type', R + '/image');
    relation.setAttribute('Target', '../media/drawing.svg');
    relDoc.documentElement.append(relation);
    parts.xml[rels] = serialize(relDoc);
    const doc = parse(parts.xml[path]);
    const blips = [...doc.getElementsByTagNameNS('*', 'blip')];
    blips[0].removeAttributeNS(R, 'embed');
    blips.forEach((blip, i) => {
      const extension = parse(
        `<a:extLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}"><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><v:svgBlip xmlns:v="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${i === 2 ? 'missing' : 'rIdSVG'}"/></a:ext></a:extLst>`
      );
      blip.append(doc.importNode(extension.documentElement, true));
    });
    parts.xml[path] = serialize(doc);
    const file = importDeck(parts);
    const items = file.deck.slides[0].items;
    const selections = items.map((o) => [
      o.kind,
      o.asset,
      o.fallbackAsset ?? null,
      o.crop[0],
    ]);
    const img = itemNode(items[0], media).querySelector('img');
    await img.decode();
    const canvas = document.createElement('canvas'),
      ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 10, 10);
    const pixel = [...ctx.getImageData(5, 5, 1, 1).data];
    const invalid = itemNode(items[1], {
      ...media,
      [svg]: 'data:image/svg+xml,broken',
    }).querySelector('img');
    await new Promise((resolve, reject) => {
      invalid.onload = resolve;
      setTimeout(() => reject(Error('Raster fallback did not load')), 3000);
    });
    const base = { ...file, parts, deck: structuredClone(file.deck) };
    const dest = blankDeck(),
      destMedia = {};
    const copies = structuredClone(items.slice(0, 2));
    pasteClipboardMedia(
      copies,
      captureClipboardMedia(copies, media),
      destMedia
    );
    dest.slides[0].items = copies;
    const copied = exportDeck(dest, null, destMedia);
    const reopened = importDeck({ xml: copied.xml, media: destMedia }).deck
      .slides[0].items;
    const refs = [
      ...parse(copied.xml[path]).getElementsByTagNameNS('*', 'blip'),
    ].map((b) => [
      b.hasAttributeNS(R, 'embed'),
      Boolean(b.getElementsByTagNameNS('*', 'svgBlip').length),
    ]);
    items[0].asset = bitmap;
    const changes = exportDeck(file.deck, base, media);
    return {
      selections,
      pixel,
      fellBack: invalid.src === media[bitmap],
      refs,
      reopened: reopened.map((o) => [
        destMedia[o.asset] === media[svg],
        !!o.fallbackAsset,
      ]),
      replaced: parse(changes.xml[path])
        .getElementsByTagNameNS('*', 'blip')[0]
        .getElementsByTagNameNS('*', 'svgBlip').length,
      sharedSVGKept: !changes.removed?.includes(svg),
    };
  }, picture.buffer.toString('base64'));
  expect(result).toEqual({
    selections: [
      ['image', 'ppt/media/drawing.svg', null, 0.15],
      ['image', 'ppt/media/drawing.svg', 'ppt/media/preview.png', 0.15],
      ['image', 'ppt/media/preview.png', null, 0.15],
    ],
    pixel: [255, 0, 0, 255],
    fellBack: true,
    refs: [
      [false, true],
      [true, true],
    ],
    reopened: [
      [true, false],
      [true, true],
    ],
    replaced: 0,
    sharedSVGKept: true,
  });
});
