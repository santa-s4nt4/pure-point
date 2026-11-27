// Run on the Windows runner against the installed release, including its real IPC.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { rawSlide, rels } from '../src/xml.js';
import { template, slideType } from '../src/template.js';

const dir = await mkdtemp(join(tmpdir(), 'pure-point-smoke-'));
const file = join(dir, '動作確認 slide.pptx');
const parts = template().xml;
parts['ppt/presentation.xml'] = parts['ppt/presentation.xml'].replace('<p:sldIdLst/>',
  '<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>');
parts['ppt/_rels/presentation.xml.rels'] = rels([
  ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'slide', 'slides/slide1.xml'],
]);
parts['ppt/slides/slide1.xml'] = rawSlide('Windows', '#ffffff');
parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('</Types>',
  `<Override PartName="/ppt/slides/slide1.xml" ContentType="${slideType}"/></Types>`);
await writeFile(file, zipSync(Object.fromEntries(
  Object.entries(parts).map(([path, xml]) => [path, strToU8(xml)])
)));
const endpoint = 'http://127.0.0.1:9222';
const app = spawn(process.argv[2], [file], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222' },
  stdio: 'inherit',
});
const stopped = new Promise(resolve => app.once('exit', resolve));
let browser;
try {
  await expect.poll(async () => {
    if (app.exitCode !== null) throw Error('Installed app exited during startup');
    return fetch(endpoint + '/json/version').then(r => r.ok, () => false);
  }, { timeout: 60000 }).toBe(true);
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  await expect.poll(() => context.pages().length).toBeGreaterThan(0);
  const page = context.pages()[0];
  await expect(page.locator('#status')).toHaveText('Saved', { timeout: 30000 });
  await page.locator('.p-menu').click();
  await expect(page.locator('.menu [data-action=save] kbd')).toHaveText('Ctrl+S');
  await expect(page.locator('.menu [data-action=redo] kbd')).toHaveText('Ctrl+Shift+Z');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Toggle script' }).click();
  const notes = page.getByRole('textbox', { name: 'Slide script' });
  await notes.fill('Windows round trip');
  // Check native text history, then document history outside the text field.
  for (const target of [notes, page.locator('.p-menu')]) {
    await target.focus();
    await page.keyboard.press('Control+z');
    await expect(notes).toHaveValue('');
    await page.keyboard.press('Control+y');
    await expect(notes).toHaveValue('');
    await page.keyboard.press('Control+Shift+z');
    await expect(notes).toHaveValue('Windows round trip');
  }
  await page.getByLabel('Slide size').selectOption({ label: '1350 × 1950 px' });
  await page.getByRole('button', { name: 'Show page numbers' }).click();
  await expect(page.locator('.artboard .slide-page-number')).toHaveText('1');
  await page.keyboard.press('Control+s');
  await expect.poll(async () => {
    const xml = unzipSync(await readFile(file))['ppt/notesSlides/notesSlide1.xml'];
    return xml && strFromU8(xml);
  }).toContain('Windows round trip');
  const saved = unzipSync(await readFile(file));
  expect(strFromU8(saved['ppt/presentation.xml'])).toContain(
    '<p:sldSz cx="8572500" cy="12382500"'
  );
  expect(strFromU8(saved['ppt/slides/slide1.xml'])).toContain('<a:t>1</a:t>');
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Open presentation window' }).click();
  const viewer = await opened;
  const projected = viewer.locator('.present-frame .scene');
  await expect(projected.locator('.slide-page-number')).toHaveText('1');
  await page.bringToFront();
  await page.locator('.artboard').dblclick({ position: { x: 45, y: 45 } });
  await page.getByRole('textbox', { name: 'Slide text' }).fill('Live display');
  await expect(projected).toContainText('Live display');
  await page.keyboard.press('Control+Enter');
  const clip = await readFile(new URL('../tests/fixtures/two-seconds.mp4', import.meta.url));
  const artboard = page.locator('.artboard');
  await artboard.evaluate((node, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'smoke.mp4', { type: 'video/mp4' }));
    const bounds = node.getBoundingClientRect();
    node.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: bounds.left + bounds.width / 2,
      clientY: bounds.top + bounds.height / 2,
    }));
  }, [...clip]);
  const movie = artboard.locator('.video-surface');
  const projectedMovie = projected.locator('video');
  await expect(movie).toBeVisible({ timeout: 30000 });
  await movie.hover();
  await movie.getByRole('button', { name: 'Play video' }).click();
  await expect.poll(() => projectedMovie.evaluate((node) => node.paused)).toBe(false);
  await movie.locator('video').evaluate((node) => {
    node.pause();
    node.currentTime = 0.85;
    node.volume = 0.45;
  });
  await expect.poll(() => projectedMovie.evaluate((node) => [
    node.paused, Math.round(node.currentTime * 100), node.volume,
  ])).toEqual([true, 85, 0.45]);
  await page.getByRole('button', { name: 'Add slide', exact: true }).click();
  await page.getByRole('button', { name: 'title', exact: true }).click();
  await expect(projected.locator('.slide-page-number')).toHaveText('2');
  await expect(projectedMovie).toHaveCount(0);
  await viewer.bringToFront();
  await viewer.getByRole('button', { name: 'Enter fullscreen (F)', exact: true }).click();
  await expect(viewer.getByRole('button', { name: 'Exit fullscreen (F)', exact: true })).toBeVisible();
  const closed = viewer.waitForEvent('close');
  await viewer.keyboard.press('Escape').catch((error) => {
    if (!error.message.includes('has been closed')) throw error;
  });
  await closed;
  await page.bringToFront();
  await page.keyboard.press('Control+n');
  await expect.poll(() => context.pages().length).toBe(2);
  const second = context.pages().find((candidate) => candidate !== page);
  await expect(second.locator('#status')).toHaveText('Not saved yet');
  const secondOpened = context.waitForEvent('page');
  await second.getByRole('button', { name: 'Open presentation window' }).click();
  const secondViewer = await secondOpened;
  await expect(secondViewer.locator('.present-frame .scene')).toBeVisible();
  await second.bringToFront();
  const editorClosed = second.waitForEvent('close');
  const presentationClosed = secondViewer.waitForEvent('close');
  await second.keyboard.press('Control+w').catch((error) => {
    if (!error.message.includes('has been closed')) throw error;
  });
  await Promise.all([editorClosed, presentationClosed]);
  await expect(page.locator('.artboard')).toBeVisible();
} finally {
  await browser?.close();
  app.kill();
  await stopped;
  await rm(dir, { recursive: true, force: true });
}
