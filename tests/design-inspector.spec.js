import { test, expect } from '@playwright/test';
import { openFileWindow } from './document-window.js';

test('Design changes apply immediately and preserve the live text selection', async ({
  page,
}, info) => {
  await page.goto('/');
  const board = page.locator('.artboard');
  const input = page.getByRole('textbox', { name: 'Slide text' });
  const frame = board.locator('.item[data-id]');
  const layoutGrid = page.getByRole('heading', { name: 'Layout grid' });
  const snapPanel = page.getByRole('heading', { name: 'Alignment', exact: true });
  await expect(layoutGrid).toBeVisible();

  await board.dblclick({ position: { x: 120, y: 130 } });
  await page.keyboard.insertText('Hello world');
  await expect(layoutGrid).toHaveCount(0);
  await expect(snapPanel).toHaveCount(0);
  await input.evaluate((node) => {
    const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode();
    getSelection().setBaseAndExtent(text, 0, text, 5);
  });
  const expectEditing = async () => {
    await expect(input).toBeFocused();
    expect(await input.evaluate(() => getSelection().toString())).toBe('Hello');
    await expect(input).toHaveText('Hello world');
  };
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await expectEditing();
  await expect(input).toHaveCSS('font-weight', '700');

  const setNumber = async (name, value) => {
    const field = page.getByLabel(name, { exact: true });
    await field.fill(value);
    await field.press('Enter');
    await expectEditing();
  };
  await setNumber('X (px)', '350');
  expect(await frame.evaluate((node) => node.style.left)).toBe('175px');
  await setNumber('Rotation (°)', '30');
  expect(await frame.evaluate((node) => node.style.transform)).toContain('rotate(-30deg)');

  await page.getByRole('button', { name: 'Text color', exact: true }).click();
  const hex = page.getByRole('textbox', { name: 'Hex color' });
  await hex.fill('F2324E');
  await hex.press('Enter');
  await expectEditing();
  await expect(input).toHaveCSS('color', 'rgb(242, 50, 78)');

  await input.press('ControlOrMeta+Enter');
  await expect(input).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+Shift+s');
  const path = info.outputPath('design-rotation.pptx');
  await (await download).saveAs(path);
  page = await openFileWindow(page, path);
  const reopened = page.locator('.artboard .item[data-id]');
  expect(await reopened.evaluate((node) => node.style.transform)).toContain('rotate(-30deg)');
  await expect(reopened).toHaveText('Hello world');
});
