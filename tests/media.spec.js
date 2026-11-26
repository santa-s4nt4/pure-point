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
  const surface = page.locator('.artboard .video-surface');
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
  await pick(page, () => menu(page, 'open'), first);
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
  const frame = page
    .locator('.artboard .item')
    .filter({ has: page.locator('.image-clip') })
    .first();
  const first = info.outputPath('first-image.pptx');
  await exportFile(page, first);
  const oldId = await frame.getAttribute('data-id');
  await pick(page, () => menu(page, 'open'), first);
  await expect(frame).not.toHaveAttribute('data-id', oldId);
  const originalBox = await frame.boundingBox();
  await frame.dblclick();
  const crop = page.getByRole('dialog', { name: 'Crop image' });
  const leftEdge = crop.getByRole('button', { name: 'Crop left', exact: true });
  const handle = await leftEdge.boundingBox();
  const cropBox = await crop.locator('.crop-source').boundingBox();
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
  await crop.getByRole('button', { name: 'Apply crop' }).click();
  await expect
    .poll(async () => (await frame.boundingBox()).width)
    .toBeLessThan(originalBox.width);
  const croppedBox = await frame.boundingBox();
  expect(croppedBox.width / originalBox.width).toBeCloseTo(0.75, 2);
  expect(croppedBox.x + croppedBox.width).toBeCloseTo(
    originalBox.x + originalBox.width,
    1
  );
  await page.keyboard.press('Meta+z');
  expect(await frame.boundingBox()).toEqual(originalBox);
  await page.keyboard.press('Meta+Shift+z');
  const cropped = info.outputPath('cropped-image.pptx');
  const parts = await exportFile(page, cropped);
  const savedCrop = strFromU8(parts['ppt/slides/slide1.xml']).match(
    /<a:srcRect l="(\d+)"/
  );
  expect(Number(savedCrop[1]) / 100000).toBeCloseTo(0.25, 2);
  await pick(page, () => menu(page, 'open'), cropped);
  await frame.dblclick();
  await crop.getByRole('button', { name: 'Reset crop' }).click();
  await crop.getByRole('button', { name: 'Cancel' }).click();
  expect((await frame.boundingBox()).width).toBeCloseTo(croppedBox.width, 1);
  await frame.click({ button: 'right' });
  await expect(
    page.getByRole('menuitem', { name: 'Replace image…' })
  ).toBeVisible();
  await page.keyboard.press('Escape');
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
        matches: destAssets[image.asset] === assets[asset],
        independent: reopened.comments[0].id !== original.comments[0].id,
        anchored: reopened.comments[0].objectId === image.id,
      };
    });
  }, picture.buffer.toString('base64'));
  for (const result of results)
    expect(result).toEqual({
      crop: [0.15, 0.1, 0.35, 0],
      matches: true,
      independent: true,
      anchored: true,
    });
});
