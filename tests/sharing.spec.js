import { expect, test } from '@playwright/test';

test('Sharing follows the saved file and only confirms a successful link copy', async ({
  page,
}) => {
  // Exercise the title bar without changing any real OneDrive permissions.
  await page.addInitScript(() => {
    window.isTauri = true;
    window.shareTest = {
      mode: 'finder',
      path: '/onedrive/talk.pptx',
      revealed: [],
      copied: [],
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      transformCallback: () => 1,
      invoke: async (command, args) => {
        const state = window.shareTest;
        switch (command) {
          case 'system_fonts':
            return [];
          case 'save_document':
            return state.path;
          case 'share_document_mode':
            return state.mode;
          case 'reveal_share_document':
            return state.revealed.push(args.path);
          case 'copy_organization_link':
            if (state.denied) throw Error('OneDrive declined the request.');
            state.copied.push(args.path);
        }
      },
    };
  });
  await page.goto('/');
  const share = page.locator('header [data-action=copyShareLink]');
  await expect(page.locator('header #status')).toHaveText('Not saved yet');
  await expect(share).toBeHidden();

  const saveAs = async () => {
    await page.getByRole('button', { name: 'Document menu' }).click();
    await page.locator('.menu [data-action=saveAs]').click();
  };
  await saveAs();
  await expect(share).toHaveText('Share…');
  await share.click();
  await page.getByRole('button', { name: 'Show in Finder' }).click();
  await expect
    .poll(() => page.evaluate(() => window.shareTest.revealed))
    .toEqual(['/onedrive/talk.pptx']);

  await page.evaluate(() =>
    Object.assign(window.shareTest, {
      mode: 'graph',
      path: '/onedrive/new.pptx',
    })
  );
  await saveAs();
  await expect(share).toHaveText('Copy link');
  await share.click();
  await expect(page.locator('.toast')).toHaveText(
    'Edit link copied for people at Dentsu.'
  );
  expect(await page.evaluate(() => window.shareTest.copied)).toEqual([
    '/onedrive/new.pptx',
  ]);
  await page.evaluate(() => {
    window.shareTest.denied = true;
  });
  await share.click();
  await expect(page.getByRole('dialog')).toContainText('OneDrive declined');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.evaluate(() =>
    Object.assign(window.shareTest, {
      mode: 'none',
      path: '/desktop/private.pptx',
    })
  );
  await saveAs();
  await expect(share).toBeHidden();
});
