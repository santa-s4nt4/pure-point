import { invoke, isTauri } from '@tauri-apps/api/core';
import { createElement, Play, Pause, Volume2, VolumeX, X } from 'lucide';
import { onlineVideo } from './media-format.js';
import './media.css';

const element = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};
const glyph = (def) =>
  createElement(def, {
    width: 18,
    height: 18,
    'stroke-width': 1.7,
    'aria-hidden': 'true',
  });
function control(label, def) {
  const b = element('button', 'media-btn');
  b.type = 'button';
  b.dataset.mediaControl = '';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.append(glyph(def));
  return b;
}
function time(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  return (
    Math.floor(seconds / 60) +
    ':' +
    String(Math.floor(seconds % 60)).padStart(2, '0')
  );
}
function slider(label, step, max) {
  const s = element('input');
  s.type = 'range';
  s.setAttribute('aria-label', label);
  s.dataset.mediaControl = '';
  s.min = '0';
  s.max = String(max);
  s.step = String(step);
  s.value = '0';
  return s;
}
export function videoNode(o, assets, live = false) {
  const host = element('div', 'video-surface');
  host.dataset.videoId = o.id;
  const online = onlineVideo(o.embed);
  if (o.poster && assets[o.poster]) {
    const p = element('img', 'video-cover');
    p.alt = '';
    p.draggable = false;
    p.src = assets[o.poster];
    host.append(p);
  }
  if (!live) return host;
  const controls = element('div', 'media-controls');
  controls.dataset.mediaControl = '';
  // Keep player input out of selection, dragging and slide navigation.
  for (const event of ['pointerdown', 'click', 'dblclick', 'keydown', 'keyup'])
    controls.addEventListener(event, (e) => e.stopPropagation());
  const feedback = element('div', 'video-feedback');
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  const report = (message) => {
    feedback.textContent = message;
    feedback.hidden = false;
  };
  host.append(feedback);
  const play = control(
    online ? 'Play ' + online.provider + ' video' : 'Play video',
    Play
  );
  if (online) {
    const provider = element('span', 'video-time');
    provider.textContent = online.provider;
    controls.append(play, provider);
    host.append(controls);
    play.addEventListener('click', async () => {
      play.disabled = true;
      try {
        if (!host.isConnected) return;
        const frame = element('iframe', 'online-player');
        const url = new URL(online.embed);
        url.searchParams.set('autoplay', '1');
        frame.src =
          online.provider === 'YouTube' && isTauri()
            ? await invoke('youtube_player_url', {
                id: url.pathname.split('/').pop(),
              })
            : url.href;
        if (!host.isConnected) return;
        frame.title = online.provider + ' video';
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.allow =
          'autoplay; encrypted-media; picture-in-picture; fullscreen';
        frame.allowFullscreen = true;
        const close = control('Close player', X);
        close.classList.add('close-player');
        close.onclick = (e) => {
          e.stopPropagation();
          frame.remove();
          close.remove();
          controls.hidden = false;
          play.focus();
        };
        close.onpointerdown = (e) => e.stopPropagation();
        host.append(frame, close);
        controls.hidden = true;
      } catch (error) {
        report(String(error));
      } finally {
        play.disabled = false;
      }
    });
    return host;
  }
  if (!assets[o.asset]) {
    report('Video source unavailable');
    return host;
  }
  const video = element('video', 'local-player');
  video.playsInline = true;
  video.preload = 'none';
  if (o.poster) video.poster = assets[o.poster] || '';
  const seek = slider('Seek video', 0.01, 1),
    volume = slider('Volume', 0.01, 1),
    mute = control('Mute', Volume2);
  seek.className = 'video-seek';
  volume.className = 'video-volume';
  volume.value = '1';
  const stamp = element('span', 'video-time');
  stamp.textContent = '0:00';
  let ready = false;
  function load() {
    if (!ready) {
      video.src = assets[o.asset];
      ready = true;
    }
  }
  async function toggle() {
    load();
    if (!video.paused) {
      video.pause();
      return;
    }
    try {
      await video.play();
      feedback.hidden = true;
    } catch (e) {
      if (e.name !== 'AbortError')
        report('This video codec could not be played.');
    }
  }
  play.onclick = toggle;
  video.addEventListener('playing', () => {
    host.classList.add('playing');
    play.replaceChildren(glyph(Pause));
    play.setAttribute('aria-label', 'Pause video');
    play.title = 'Pause video';
  });
  video.addEventListener('pause', () => {
    play.replaceChildren(glyph(Play));
    play.setAttribute('aria-label', 'Play video');
    play.title = 'Play video';
  });
  video.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(video.duration)) seek.max = String(video.duration);
  });
  video.addEventListener('timeupdate', () => {
    seek.value = String(video.currentTime);
    stamp.textContent = time(video.currentTime);
  });
  video.addEventListener('error', () =>
    report('This video codec could not be played.')
  );
  host.addEventListener(
    'pointerenter',
    () => {
      if (!ready) {
        video.preload = 'metadata';
        load();
      }
    },
    { once: true }
  );
  seek.oninput = () => {
    load();
    if (Number.isFinite(video.duration)) video.currentTime = Number(seek.value);
  };
  mute.onclick = () => {
    video.muted = !video.muted;
  };
  volume.oninput = () => {
    video.volume = Number(volume.value);
    video.muted = false;
  };
  video.onvolumechange = () => {
    const silent = video.muted || !video.volume;
    mute.replaceChildren(glyph(silent ? VolumeX : Volume2));
    mute.setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
    volume.value = String(video.muted ? 0 : video.volume);
  };
  controls.append(play, seek, stamp, mute, volume);
  host.append(video, controls);
  return host;
}
