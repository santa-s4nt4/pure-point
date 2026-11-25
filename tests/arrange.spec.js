import { expect, test } from '@playwright/test';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

async function openSlides(page, file) {
  await page.locator('.p-menu').click();
  const picking = page.waitForEvent('filechooser');
  await page.locator('[data-action=open]').click();
  await (
    await picking
  ).setFiles({
    name: 'Layers.pptx',
    mimeType: 'application/octet-stream',
    buffer: file,
  });
  await expect(page.locator('#status')).toHaveText('Saved');
}

async function makeDeck(page) {
  await page.goto('/');
  const parts = await page.evaluate(async () => {
    const { shape, slide } = await import('/src/model.js');
    const { exportDeck } = await import('/src/export.js');
    const rear = shape('rect', 'Rear', 40, 60, 80, 60, { fill: '#FF0022' });
    const front = shape('rect', 'Front', 240, 190, 90, 65, { fill: '#334455' });
    return exportDeck(
      {
        w: 960,
        h: 540,
        slides: [
          slide('', '#FFFFFF', [rear, front]),
          slide(),
          slide(),
          slide(),
        ],
      },
      null
    ).xml;
  });
  await openSlides(
    page,
    Buffer.from(
      zipSync(
        Object.fromEntries(
          Object.entries(parts).map(([k, v]) => [k, strToU8(v)])
        )
      )
    )
  );
}

test('Slide selections in the right pane use section and deletion shortcuts', async ({
  page,
}) => {
  await makeDeck(page);
  await page.locator('[data-action=slides]').click();
  const pages = page.locator('.inspector-slides');
  await pages.locator('[data-slide="1"]').click();
  await pages.locator('[data-slide="2"]').click({ modifiers: ['Meta'] });
  await page.keyboard.press('Meta+g');
  await page.getByLabel('Section name').fill('Middle');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(pages.getByRole('button', { name: /Middle/ })).toBeVisible();
  await expect(pages.locator('.chosen')).toHaveCount(2);
  await page.keyboard.press('Backspace');
  await expect(pages.locator('[data-slide]')).toHaveCount(2);
  await page.keyboard.press('Meta+z');
  await expect(pages.locator('[data-slide]')).toHaveCount(4);
  await pages.locator('[data-slide="3"]').click();
  await page.keyboard.press('Delete');
  await expect(pages.locator('[data-slide]')).toHaveCount(3);
});

test('Alignment, staged color, layer ordering, and object comments round-trip', async ({
  page,
}) => {
  await makeDeck(page);
  const art = page.locator('.artboard'),
    objects = art.locator('.scene > [data-id]');
  await objects.first().click();
  await page.locator('[data-action=objectAlign-right]').click();
  await expect(
    page.getByRole('spinbutton', { name: 'X (px)', exact: true })
  ).toHaveValue('1760');
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  await page.getByLabel('Hex color').fill('009966');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('[data-color=fill]')).toContainText('FF0022');
  await page.locator('[data-color=fill]').click();
  await page.getByLabel('Hex color').fill('#009966');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('[data-color=fill]')).toContainText('009966');
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await page.locator('[data-action=objectAlign-top]').click();
  const tops = await objects.evaluateAll((nodes) =>
    nodes.map((n) => n.getBoundingClientRect().y)
  );
  expect(tops[0]).toBeCloseTo(tops[1], 3);
  await page.locator('[data-action=layers]').click();
  const rows = page.locator('.layer-row');
  await rows.nth(1).locator('[data-layer]').click();
  await rows.nth(1).dragTo(rows.first(), { targetPosition: { x: 40, y: 2 } });
  await expect(rows.first().locator('[data-layer]')).toHaveText('Rear');
  await rows.first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add comment…' }).click();
  await expect(page.getByText('Comment on Rear')).toBeVisible();
  await page
    .getByLabel('Comment', { exact: true })
    .fill('Keep the green shape');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(page.locator('.comment-card .comment-target')).toHaveText(
    'Rear'
  );
  await page.locator('.p-menu').click();
  const download = page.waitForEvent('download');
  await page.locator('[data-action=saveAs]').click();
  const chunks = [];
  for await (const chunk of await (await download).createReadStream())
    chunks.push(chunk);
  const file = Buffer.concat(chunks),
    zip = unzipSync(file);
  const comments = Object.entries(zip).find(
    ([p]) => p.includes('/comments/') && p.endsWith('.xml')
  );
  expect(strFromU8(comments[1])).toContain('ac:deMkLst');
  await openSlides(page, file);
  await page.locator('[data-action=comments]').click();
  await expect(page.locator('.comment-card .comment-target')).toHaveText(
    'Rear'
  );
  await page.locator('[data-action=layers]').click();
  await expect(rows.first().locator('[data-layer]')).toHaveText('Rear');
});
