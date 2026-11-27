import { expect, test } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';
import { openFileWindow } from './document-window.js';

test('Opening a PPTX reuses an untouched editor after canceling and rejecting a bad file', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('Not saved yet');
  const cancel = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (await cancel).element().dispatchEvent('cancel');
  await expect(page.locator('#status')).toHaveText('Not saved yet');

  const choose = page.waitForEvent('filechooser');
  await page.keyboard.press('ControlOrMeta+o');
  await (await choose).setFiles({
    name: 'broken.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from('invalid archive'),
  });
  const error = page.getByRole('dialog');
  await expect(error).toBeVisible();
  await error.getByRole('button').click();
  await expect(page.locator('.doc-name')).toHaveText('untitled.pptx');
  await expect(page.locator('#status')).toHaveText('Not saved yet');

  const parts = await page.evaluate(async () => {
    const { blankDeck, textItem } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const deck = blankDeck();
    deck.slides[0].items.push(textItem('Opened here', 16, 16, 200, 40, 20));
    return exportDeck(deck).xml;
  });
  const buffer = Buffer.from(zipSync(Object.fromEntries(
    Object.entries(parts).map(([name, xml]) => [name, strToU8(xml)])
  )));
  const loaded = await openFileWindow(page, {
    name: 'presentation.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer,
  });
  expect(loaded).toBe(page);
  expect(context.pages()).toHaveLength(1);
  await expect(page.locator('.doc-name')).toHaveText('presentation.pptx');
  await expect(page.locator('.artboard .item-text')).toHaveText('Opened here');
});
