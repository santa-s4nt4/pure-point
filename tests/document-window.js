import { expect } from '@playwright/test';

export async function openFileWindow(
  page,
  file,
  open = () => page.keyboard.press('Meta+o')
) {
  const [picker] = await Promise.all([
    page.waitForEvent('filechooser'),
    // This renderer round trip lets Chrome enable file chooser interception
    // before the keyboard shortcut, and waits for the editor to accept it.
    page
      .locator('#status')
      .filter({ hasNotText: 'Working…' })
      .waitFor()
      .then(open),
  ]);
  const [child] = await Promise.all([
    page.waitForEvent('popup'),
    picker.setFiles(file),
  ]);
  await expect(child.locator('#status')).toHaveText('Saved');
  return child;
}
