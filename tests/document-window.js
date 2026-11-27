import { expect } from '@playwright/test';

export async function openFileWindow(
  page,
  file,
  open = () => page.keyboard.press('Meta+o')
) {
  const picker = page.waitForEvent('filechooser');
  const opened = page.context().waitForEvent('page');
  await open();
  await (await picker).setFiles(file);
  const child = await opened;
  await expect(child.locator('#status')).toHaveText('Saved');
  return child;
}
