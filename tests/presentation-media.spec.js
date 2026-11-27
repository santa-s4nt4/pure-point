import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const movie = fileURLToPath(new URL('./fixtures/two-seconds.mp4', import.meta.url));

async function openViewer(page) {
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open presentation window' }).click();
  const viewer = await opened;
  await expect(viewer.locator('.present-frame .scene')).toBeVisible();
  await page.bringToFront();
  return viewer;
}

test('Local video follows editor playback, seeks and audio without replacing the player', async ({ page }) => {
  await page.goto('/');
  const pick = page.waitForEvent('filechooser');
  await page.locator('[data-action="tool-video"]').click();
  await (await pick).setFiles(movie);
  const editor = page.locator('.artboard .video-surface');
  await expect(editor).toBeVisible();
  const viewer = await openViewer(page);
  const source = editor.locator('video');
  const projected = viewer.locator('.present-frame video');
  await editor.hover();
  await editor.getByRole('button', { name: 'Play video', exact: true }).click();
  await expect.poll(() => source.evaluate((video) => [video.paused, video.muted])).toEqual([false, true]);
  await expect.poll(() => projected.evaluate((video) => video.currentTime)).toBeGreaterThan(0);
  await expect.poll(() => projected.evaluate((video) => video.muted)).toBe(false);
  await editor.getByRole('button', { name: 'Pause video', exact: true }).click();
  await expect.poll(() => projected.evaluate((video) => video.paused)).toBe(true);
  await editor.getByRole('slider', { name: 'Seek video' }).fill('1.2');
  await expect.poll(() => projected.evaluate((video) => video.currentTime)).toBeCloseTo(1.2, 1);
  await editor.getByRole('slider', { name: 'Volume', exact: true }).fill('0.34');
  await expect.poll(() => projected.evaluate((video) => [video.volume, video.muted])).toEqual([0.34, false]);
  await editor.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect.poll(() => projected.evaluate((video) => [video.volume, video.muted])).toEqual([0.34, true]);
  await projected.evaluate((video) => { video.dataset.existing = 'yes'; });
  await editor.locator('video').evaluate((video) => { video.dataset.existing = 'yes'; });
  await page.locator('.artboard').dblclick({ position: { x: 70, y: 60 } });
  await page.getByRole('textbox', { name: 'Slide text' }).fill('Editing while projected');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(viewer.locator('.present-frame .item-text')).toHaveText('Editing while projected');
  await expect(projected).toHaveAttribute('data-existing', 'yes');
  await expect(editor.locator('video')).toHaveAttribute('data-existing', 'yes');
  await viewer.close();
  await expect.poll(() => source.evaluate((video) => video.muted)).toBe(true);
  await editor.hover();
  await editor.getByRole('button', { name: 'Unmute', exact: true }).click();
  await expect.poll(() => source.evaluate((video) => [video.volume, video.muted])).toEqual([0.34, false]);

  const reopened = await openViewer(page);
  await expect.poll(() => source.evaluate((video) => video.muted)).toBe(true);
  const closed = reopened.waitForEvent('close');
  await reopened.locator('.video-volume').focus();
  await reopened.keyboard.press('Escape').catch((error) => {
    if (!error.message.includes('has been closed')) throw error;
  });
  await closed;
  await expect.poll(() => source.evaluate((video) => [video.volume, video.muted])).toEqual([0.34, false]);
});

const youtubeStub = () => {
  window.YT = {
    Player: function (_frame, { events }) {
      const state = { time: 0, playing: false, volume: 100, muted: false, rate: 1 };
      const changed = () => events.onStateChange?.();
      Object.assign(this, {
        getCurrentTime: () => state.time,
        getPlayerState: () => state.playing ? 1 : 2,
        getVolume: () => state.volume,
        isMuted: () => state.muted,
        getPlaybackRate: () => state.rate,
        playVideo: () => { state.playing = true; changed(); },
        pauseVideo: () => { state.playing = false; changed(); },
        seekTo: (time) => { state.time = time; },
        setVolume: (volume) => { state.volume = volume; },
        setPlaybackRate: (rate) => { state.rate = rate; },
        mute: () => { state.muted = true; },
        unMute: () => { state.muted = false; },
      });
      window.testPlayer = this;
      window.testState = state;
      queueMicrotask(() => events.onReady({ target: this }));
    },
  };
  window.onYouTubeIframeAPIReady();
};

const vimeoStub = () => {
  const announce = (event, data) => parent.postMessage({ event, data }, '*');
  const state = {
    time: 0,
    playing: new URLSearchParams(location.search).get('autoplay') === '1',
    volume: 1,
    muted: new URLSearchParams(location.search).get('muted') === '1',
    rate: 1,
  };
  const playing = (value) => {
    state.playing = value;
    announce(value ? 'play' : 'pause', { seconds: state.time });
  };
  const seek = (value) => {
    state.time = value;
    announce('seeked', { seconds: value });
  };
  const sound = (volume, muted) => {
    Object.assign(state, { volume, muted });
    announce('volumechange', { volume, muted });
  };
  const methods = {
    ping() {},
    addEventListener() {},
    getPaused: () => !state.playing,
    getCurrentTime: () => state.time,
    getVolume: () => state.volume,
    getMuted: () => state.muted,
    getPlaybackRate: () => state.rate,
    getDuration: () => 60,
    play: () => playing(true),
    pause: () => playing(false),
    setCurrentTime: seek,
    setVolume: (value) => sound(value, state.muted),
    setMuted: (value) => sound(state.volume, value),
  };
  addEventListener('message', (event) => {
    if (event.source !== parent) return;
    const { method, value } = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    if (methods[method])
      parent.postMessage({ method, value: methods[method](value) }, '*');
  });
  window.testPlayer = {
    playVideo: methods.play,
    pauseVideo: methods.pause,
    seekTo: seek,
    setVolume: methods.setVolume,
    mute: () => sound(state.volume, true),
    unMute: () => sound(state.volume, false),
  };
  window.testState = state;
  announce('ready');
};

for (const provider of ['YouTube', 'Vimeo']) {
  test(provider + ' player control is relayed from its embedded frame to the presentation', async ({ page, context }) => {
    const youtube = provider === 'YouTube';
    if (youtube) {
      await context.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({
        contentType: 'application/javascript',
        body: '(' + youtubeStub.toString() + ')()',
      }));
      await context.route('https://www.youtube.com/embed/**', (route) => route.fulfill({ body: '<html></html>' }));
    } else {
      await context.route('https://player.vimeo.com/video/**', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<script>(' + vimeoStub.toString() + ')()</script>',
      }));
    }
    await page.goto('/');
    await page.locator('[data-action="tool-embed"]').click();
    await page.getByLabel('Video URL').fill(youtube ? 'https://youtu.be/M7lc1UVf-VE' : 'https://vimeo.com/76979871');
    await page.getByRole('button', { name: 'Embed', exact: true }).click();
    const editor = page.locator('.artboard .video-surface');
    await editor.hover();
    await editor.getByRole('button', { name: 'Play ' + provider + ' video' }).click();
    const source = await editor.locator('iframe').elementHandle();
    const sourceFrame = await source.contentFrame();
    await expect.poll(() => sourceFrame.evaluate(() => window.testState)).toMatchObject({ playing: true, muted: false });
    const viewer = await openViewer(page);
    const target = await viewer.locator('.present-frame iframe').elementHandle();
    const targetFrame = await target.contentFrame();
    const sourceState = () => sourceFrame.evaluate(() => window.testState);
    const targetState = () => targetFrame.evaluate(() => window.testState);
    await expect.poll(sourceState).toMatchObject({ playing: true, muted: true });
    await expect.poll(targetState).toMatchObject({ playing: true, muted: false });
    await sourceFrame.evaluate((volume) => {
      window.testPlayer.unMute();
      window.testPlayer.setVolume(volume);
    }, youtube ? 40 : 0.4);
    await expect.poll(sourceState).toMatchObject({ muted: true, volume: youtube ? 40 : 0.4 });
    await expect.poll(targetState).toMatchObject({ muted: false, volume: youtube ? 40 : 0.4 });
    await editor.getByRole('slider', { name: 'Volume', exact: true }).fill('0.3');
    await editor.getByRole('button', { name: 'Mute', exact: true }).click();
    await expect.poll(targetState).toMatchObject({ muted: true, volume: youtube ? 30 : 0.3 });
    await editor.getByRole('button', { name: 'Unmute', exact: true }).click();
    await expect.poll(sourceState).toMatchObject({ muted: true, volume: youtube ? 30 : 0.3 });
    await expect.poll(targetState).toMatchObject({ muted: false, volume: youtube ? 30 : 0.3 });
    await sourceFrame.evaluate(() => {
      window.testPlayer.pauseVideo();
      window.testPlayer.seekTo(14);
    });
    await expect.poll(targetState).toMatchObject({ playing: false, time: 14 });
    await sourceFrame.evaluate(() => window.testPlayer.playVideo());
    await expect.poll(targetState).toMatchObject({ playing: true, muted: false });
    await viewer.close();
    await expect.poll(sourceState).toMatchObject({ playing: true, time: 14, muted: false, volume: youtube ? 30 : 0.3 });
    await expect(editor.getByRole('slider', { name: 'Volume', exact: true })).toBeHidden();
  });
}
