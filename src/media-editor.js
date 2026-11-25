import { pickFile, toData } from './platform.js';
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
  const { mime, ext } = fileFormat(file, images),
    image = new Image();
  const data = stored(mime, ext, await toData(file));
  image.src = data.value;
  await image.decode();
  return {
    kind: 'image',
    name: file.name,
    w: image.naturalWidth,
    h: image.naturalHeight,
    files: [data],
    props: { asset: data.path, crop: [0, 0, 0, 0] },
  };
}
async function videoFile(file) {
  const { mime, ext } = fileFormat(file, videoTypes);
  const url = URL.createObjectURL(file),
    video = document.createElement('video');
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
    const cover = stored('image/png', 'png', canvas.toDataURL()),
      asset = stored(mime, ext, await toData(file));
    return {
      kind: 'video',
      name: file.name,
      w: video.videoWidth,
      h: video.videoHeight,
      files: [asset, cover],
      props: {
        asset: asset.path,
        poster: cover.path,
        embed: null,
        crop: [0, 0, 0, 0],
      },
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
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
    if (!stillActive(deck, slide)) return;
    put(result.files, getAssets());
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
    addObject(shape(result.kind, result.name, x, y, w, h, result.props));
  }
  async function pick(kind) {
    const deck = getDeck(),
      slide = getSlide();
    if (kind === 'embed') {
      const url = await askVideo();
      if (url) insert(embedVideo(url), deck, slide);
      return;
    }
    const file = await pickFile(
      kind === 'image' ? '.png,.jpg,.jpeg,.gif,.webp' : videoAccept
    );
    if (!file) return;
    insert(
      await (kind === 'image' ? imageFile(file) : videoFile(file)),
      deck,
      slide
    );
  }
  const sourceAt = (node) => {
    const id = node.closest('[data-id]')?.dataset.id;
    return id ? editableMedia(getSlide().items, id) : undefined;
  };
  function replace(target, result, deck, slide) {
    if (
      !stillActive(deck, slide) ||
      editableMedia(slide.items, target.id) !== target
    )
      return;
    put(result.files, getAssets());
    change(() => {
      Object.assign(target, result.props, { name: result.name });
    });
  }
  function bind(stage) {
    stage.addEventListener(
      'dblclick',
      async (e) => {
        if (isBusy() || e.target.closest('[data-media-control]')) return;
        const target = sourceAt(e.target);
        if (target?.kind !== 'image') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const deck = getDeck(),
          slide = getSlide();
        try {
          const file = await pickFile('.png,.jpg,.jpeg,.gif,.webp');
          if (file) replace(target, await imageFile(file), deck, slide);
        } catch (err) {
          fail(err);
        }
      },
      true
    );
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
    insertImage: () => pick('image'),
    insertVideo: () => pick('video'),
    insertEmbed: () => pick('embed'),
    bind,
  };
}
