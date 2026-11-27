import { expect } from '@playwright/test';

export async function openFileWindow(
  page,
  file,
  open = () => page.keyboard.press('ControlOrMeta+o')
) {
  const status = page.locator('#status');
  const [picker, reuse] = await Promise.all([
    page.waitForEvent('filechooser'),
    // This renderer round trip lets Chrome enable file chooser interception
    // before the keyboard shortcut, and waits for the editor to accept it.
    status.filter({ hasNotText: 'Working…' }).waitFor().then(async () => {
      const reuse = (await status.textContent()) === 'Not saved yet';
      await open();
      return reuse;
    }),
  ]);
  if (reuse) {
    await picker.setFiles(file);
    await expect(status).toHaveText('Saved');
    return page;
  }
  const [child] = await Promise.all([
    page.waitForEvent('popup'),
    picker.setFiles(file),
  ]);
  await expect(child.locator('#status')).toHaveText('Saved');
  return child;
}
