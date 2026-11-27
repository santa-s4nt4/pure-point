import { invoke } from '@tauri-apps/api/core';
import { native, pickFile, toData, releaseMovies } from './platform.js';
import { shape, uid } from './model.js';
import { onlineVideo, videoTypes } from './media-format.js';

const images = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
const videoAccept = '.mp4,.m4v,.mov,.webm,.ogv,.mpeg,.mpg,.avi,.wmv';
function fileFormat(file, formats) {
  const extension = file.name.split('.').pop().toLowerCase();
  const mime = formats[extension];
  if (!mime)
    throw Error(
      formats === images
        ? 'Choose a PNG, JPEG, GIF, or WebP image.'
        : 'Choose a video file such as MP4, MOV, or WebM.'
    );
  return { ext: extension, mime };
}
function stored(mime, ext, data) {
  const path = 'ppt/media/pure-point-' + uid() + '.' + ext;
  return {
    path,
    value: 'data:' + mime + ';base64,' + data.slice(data.indexOf(',') + 1),
  };
}
const put = (files, assets) => {
  for (const f of files) assets[f.path] = f.value;
};
function onlineCover(label) {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const c = canvas.getContext('2d');
  c.fillStyle = '#191B20';
  c.fillRect(0, 0, 960, 540);
  c.fillStyle = '#f4f5f7';
  c.beginPath();
  c.moveTo(458, 214);
  c.lineTo(458, 306);
  c.lineTo(529, 260);
  c.closePath();
  c.fill();
  c.font = '22px -apple-system, sans-serif';
  c.textAlign = 'center';
  c.fillStyle = '#bdc0c8';
  c.fillText(label, 480, 372);
  return stored('image/png', 'png', canvas.toDataURL());
}
function waitForMedia(video, event) {
  return new Promise((resolve, reject) => {
    const done = (error) => {
      clearTimeout(timeout);
      video.removeEventListener(event, ok);
      video.removeEventListener('error', bad);
      error ? reject(error) : resolve();
    };
    const ok = () => done(),
      bad = () =>
        done(
          Error('This video cannot be decoded on this Mac. Try an H.264 MP4.')
        );
    const timeout = setTimeout(
      () => done(Error('Reading the video took too long.')),
      20000
    );
    video.addEventListener(event, ok, { once: true });
    video.addEventListener('error', bad, { once: true });
  });
}
async function imageFile(file) {
  // Clipboard image files can have no filename, or carry a PNG rendering of
  // an image whose original filename had a different extension.
  const ext =
    Object.keys(images).find((key) => images[key] === file.type) ||
    fileFormat(file, images).ext;
  const mime = images[ext],
    image = new Image();
  const data = stored(mime, ext, await toData(file));
  image.src = data.value;
  await image.decode();
  return {
    kind: 'image',
    name: file.name || `Pasted image.${ext}`,
    w: image.naturalWidth,
    h: image.naturalHeight,
    files: [data],
    props: { asset: data.path, crop: [0, 0, 0, 0] },
  };
}
function videoResult(name, asset, { w, h, poster }) {
  const cover = stored('image/png', 'png', poster);
  return {
    name,
    w,
    h,
    kind: 'video',
    files: [asset, cover],
    props: {
      asset: asset.path,
      poster: cover.path,
      embed: null,
      crop: [0, 0, 0, 0],
    },
  };
}
async function preparedVideo(info) {
  const { name, asset } = info;
  const ext =
    asset.mime === 'video/mp4' ? 'mp4' : fileFormat({ name }, videoTypes).ext;
  const movie = {
    path: 'ppt/media/pure-point-' + uid() + '.' + ext,
    value: asset,
  };
  try {
    const metadata = info.poster ? info : await previewVideo(asset.url, true);
    return videoResult(name, movie, metadata);
  } catch (error) {
    await releaseMovies([asset]);
    throw error;
  }
}
async function droppedMovie(file) {
  const id = await invoke('start_movie_upload', {
    name: file.name,
    size: file.size,
  });
  try {
    const chunk = 1024 * 1024;
    for (let offset = 0; offset < file.size; offset += chunk) {
      const bytes = await file.slice(offset, offset + chunk).arrayBuffer();
      await invoke('append_movie_chunk', bytes, {
        headers: { 'x-movie-id': id, 'x-movie-offset': String(offset) },
      });
    }
    return preparedVideo(await invoke('finish_movie_upload', { id }));
  } finally {
    await invoke('cancel_movie_upload', { id });
  }
}
async function videoFile(file) {
  if (native) return droppedMovie(file);
  const { mime, ext } = fileFormat(file, videoTypes);
  const url = URL.createObjectURL(file);
  try {
    const metadata = await previewVideo(url);
    return videoResult(
      file.name,
      stored(mime, ext, await toData(file)),
      metadata
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function previewVideo(url, crossOrigin = false) {
  const video = document.createElement('video');
  if (crossOrigin) video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    const loaded = waitForMedia(video, 'loadeddata');
    video.src = url;
    await loaded;
    if (!video.videoWidth || !video.videoHeight)
      throw Error('The selected file has no video track.');
    if (Number.isFinite(video.duration) && video.duration > 0.1) {
      const sought = waitForMedia(video, 'seeked');
      video.currentTime = Math.min(0.25, video.duration / 4);
      await sought;
    }
    const canvas = document.createElement('canvas'),
      ratio = Math.min(1, 960 / video.videoWidth, 960 / video.videoHeight);
    canvas.width = Math.max(1, Math.round(video.videoWidth * ratio));
    canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return {
      w: video.videoWidth,
      h: video.videoHeight,
      poster: canvas.toDataURL(),
    };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
function embedVideo(raw) {
  const info = onlineVideo(raw);
  if (!info) throw Error('Enter a YouTube or Vimeo video URL.');
  const cover = onlineCover(info.provider);
  return {
    kind: 'video',
    name: info.provider + ' video',
    w: 960,
    h: 540,
    files: [cover],
    props: {
      asset: null,
      poster: cover.path,
      embed: info.embed,
      crop: [0, 0, 0, 0],
    },
  };
}
function askVideo() {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.innerHTML =
      '<form><h3>Embed video</h3><label class="field" style="margin-top:14px">YouTube or Vimeo URL<input required aria-label="Video URL" type="text" placeholder="https://…" autocomplete="off" spellcheck="false"></label><div class="buttons"><button type="button" class="top-action">Cancel</button><button class="top-action primary" type="submit">Embed</button></div></form>';
    const input = dialog.querySelector('input');
    dialog.querySelector('[type=button]').onclick = () => dialog.close();
    dialog.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const info = onlineVideo(input.value);
      if (!info) {
        input.setCustomValidity('Enter a YouTube or Vimeo video URL.');
        input.reportValidity();
        return;
      }
      dialog.close(info.embed);
    };
    input.oninput = () => input.setCustomValidity('');
    dialog.onclose = () => {
      const value = dialog.returnValue;
      dialog.remove();
      resolve(value);
    };
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}
function editableMedia(items, id) {
  for (const o of items) {
    if (o.locked || o.hidden) continue;
    if (o.id === id && ['image', 'video'].includes(o.kind)) return o;
    if (o.items) {
      const child = editableMedia(o.items, id);
      if (child) return child;
    }
  }
}
function mediaObject(result, deck, point) {
  const ratio = Math.min(
    (deck.w * 0.55) / result.w,
    (deck.h * 0.65) / result.h,
    1
  );
  const w = result.w * ratio,
    h = result.h * ratio;
  const x = point
    ? Math.max(0, Math.min(deck.w - w, point.x - w / 2))
    : (deck.w - w) / 2;
  const y = point
    ? Math.max(0, Math.min(deck.h - h, point.y - h / 2))
    : (deck.h - h) / 2;
  return shape(result.kind, result.name, x, y, w, h, result.props);
}

export async function readClipboardImages(files, deck, center) {
  const items = [],
    assets = {};
  for (const [i, file] of files.entries()) {
    const image = await imageFile(file);
    put(image.files, assets);
    const offset = i * 12;
    items.push(
      mediaObject(image, deck, { x: center.x + offset, y: center.y + offset })
    );
  }
  return { items, assets };
}

export function createMediaEditor({
  getDeck,
  getAssets,
  getSlide,
  addObject,
  change,
  fail,
  isBusy,
}) {
  const stillActive = (deck, slide) =>
    deck === getDeck() && slide === getSlide();
  function insert(result, deck, slide, point) {
    if (!stillActive(deck, slide)) {
      releaseMovies(result.files.map((f) => f.value));
      return;
    }
    put(result.files, getAssets());
    addObject(mediaObject(result, deck, point));
  }
  async function chooseMedia(kind) {
    if (kind === 'embed') {
      const url = await askVideo();
      return url ? embedVideo(url) : null;
    }
    if (kind === 'video' && native) {
      const movie = await invoke('pick_movie');
      return movie ? preparedVideo(movie) : null;
    }
    const file = await pickFile(
      kind === 'image' ? '.png,.jpg,.jpeg,.gif,.webp' : videoAccept
    );
    if (!file) return null;
    return kind === 'image' ? imageFile(file) : videoFile(file);
  }
  async function pick(kind) {
    const deck = getDeck(),
      slide = getSlide();
    const result = await chooseMedia(kind);
    if (result) insert(result, deck, slide);
  }
  async function replaceMedia(target) {
    const deck = getDeck(),
      slide = getSlide();
    if (isBusy() || !target || editableMedia(slide.items, target.id) !== target)
      return;
    const result = await chooseMedia(target.kind);
    if (result) replace(target, result, deck, slide);
  }
  const sourceAt = (node) => {
    const id = node.closest('[data-id]')?.dataset.id;
    return id ? editableMedia(getSlide().items, id) : undefined;
  };
  function replace(target, result, deck, slide) {
    if (
      !stillActive(deck, slide) ||
      editableMedia(slide.items, target.id) !== target
    ) {
      releaseMovies(result.files.map((f) => f.value));
      return;
    }
    put(result.files, getAssets());
    change(() => {
      delete target.fallbackAsset;
      Object.assign(target, result.props, { name: result.name });
    });
  }
  function bind(stage) {
    let hover;
    const clear = () => {
      hover?.classList.remove('media-drop-target');
      hover = null;
    };
    const supports = (e) =>
      [...e.dataTransfer.types].some((t) =>
        ['Files', 'text/uri-list', 'text/plain'].includes(t)
      );
    stage.addEventListener('dragover', (e) => {
      if (isBusy() || !supports(e) || !e.target.closest('.artboard')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      clear();
      if (sourceAt(e.target)) {
        hover = e.target.closest('[data-id]');
        hover.classList.add('media-drop-target');
      }
    });
    stage.addEventListener('dragleave', (e) => {
      if (!stage.contains(e.relatedTarget)) clear();
    });
    stage.addEventListener('drop', async (e) => {
      clear();
      if (isBusy() || !supports(e) || !e.target.closest('.artboard')) return;
      e.preventDefault();
      e.stopPropagation();
      const deck = getDeck(),
        slide = getSlide(),
        target = sourceAt(e.target),
        file = e.dataTransfer.files[0];
      const box = stage.querySelector('.artboard').getBoundingClientRect();
      const at = {
        x: ((e.clientX - box.left) * deck.w) / box.width,
        y: ((e.clientY - box.top) * deck.h) / box.height,
      };
      try {
        let data;
        if (file) {
          const ext = file.name.split('.').pop().toLowerCase();
          if (!images[ext] && !videoTypes[ext]) return;
          data = await (images[ext] ? imageFile(file) : videoFile(file));
        } else {
          const raw =
            e.dataTransfer
              .getData('text/uri-list')
              .split(/\r?\n/)
              .find((line) => line && !line.startsWith('#')) ||
            e.dataTransfer.getData('text/plain');
          if (!onlineVideo(raw)) return;
          data = embedVideo(raw);
        }
        if (target?.kind === data.kind) replace(target, data, deck, slide);
        else insert(data, deck, slide, at);
      } catch (err) {
        fail(err);
      }
    });
  }
  return {
    replaceMedia,
    insertImage: () => pick('image'),
    insertVideo: () => pick('video'),
    insertEmbed: () => pick('embed'),
    bind,
  };
}
