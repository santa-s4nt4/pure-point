import { expect, test } from '@playwright/test';

test('Presentation window follows the editor and shows text before committing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('Not saved yet');
  const board = page.locator('.artboard');
  const open = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open presentation window' }).click();
  const viewer = await open;
  const slide = viewer.locator('.present-frame .scene');
  await expect(slide).toBeVisible();
  await expect(viewer.locator('.stage, .inspector, .footer')).toHaveCount(0);
  await page.bringToFront();

  await board.dblclick({ position: { x: 90, y: 90 } });
  const input = page.getByRole('textbox', { name: 'Slide text' });
  await input.fill('Live in the presentation');
  await expect(input).toBeFocused();
  await expect(slide).toHaveText('Live in the presentation');
  await page.keyboard.press('ControlOrMeta+Enter');

  const bounds = await board.boundingBox();
  const object = await board.locator('.item[data-id]').boundingBox();
  const left = await slide.locator('.item').evaluate((node) => parseFloat(node.style.left));
  await page.mouse.move(object.x + 5, object.y + object.height / 2);
  await page.mouse.down();
  await page.mouse.move(object.x + 5 + bounds.width / 5, object.y + object.height / 2, { steps: 4 });
  await expect.poll(() => slide.locator('.item').evaluate((node) => parseFloat(node.style.left))).toBeGreaterThan(left + 100);
  await page.mouse.up();

  await page.getByRole('button', { name: 'Add slide', exact: true }).click();
  await page.getByRole('button', { name: 'title', exact: true }).click();
  await expect(slide).toHaveText('');
  await page.locator('.rail [data-slide="0"]').click();
  await expect(slide).toHaveText('Live in the presentation');
  await viewer.bringToFront();
  const closed = viewer.waitForEvent('close');
  await viewer.keyboard.press('Escape').catch((error) => {
    if (!error.message.includes('has been closed')) throw error;
  });
  await closed;
  await expect(page.locator('.artboard')).toBeVisible();

  const reopened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open presentation window' }).click();
  const replacement = await reopened;
  await expect(replacement.locator('.present-frame .scene')).toHaveText('Live in the presentation');
  await page.bringToFront();
  const ownerClosed = replacement.waitForEvent('close');
  page.once('dialog', (dialog) => dialog.accept());
  await page.close({ runBeforeUnload: true });
  await ownerClosed;
});
