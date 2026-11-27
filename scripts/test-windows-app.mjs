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
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Toggle script' }).click();
  await page.getByRole('textbox', { name: 'Slide script' }).fill('Windows round trip');
  await page.keyboard.press('Control+s');
  await expect.poll(async () => {
    const xml = unzipSync(await readFile(file))['ppt/notesSlides/notesSlide1.xml'];
    return xml && strFromU8(xml);
  }).toContain('Windows round trip');
  await page.keyboard.press('Control+n');
  await expect.poll(() => context.pages().length).toBe(2);
} finally {
  await browser?.close();
  app.kill();
  await stopped;
  await rm(dir, { recursive: true, force: true });
}
