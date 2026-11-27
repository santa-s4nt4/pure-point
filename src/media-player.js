import { invoke, isTauri } from '@tauri-apps/api/core';
import { createElement, Play, Pause, Volume2, VolumeX, X } from 'lucide';
import { mediaURL, onlineVideo, setImageSource } from './media-format.js';
import { currentTime, trackPlayback } from './playback.js';
import { connectYouTube, connectVimeo } from './online-playback.js';
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
const initialPlayback = {
  opened: true,
  time: 0,
  playing: true,
  volume: 1,
  muted: false,
  rate: 1,
};

function onlineControls(host, online, controls, play, report, clear, observe) {
  const provider = element('span', 'video-time');
  provider.textContent = online.provider;
  controls.append(play, provider);
  host.append(controls);
  let player, frame, close, desired, opening;
  let generation = 0;
  function detach() {
    generation++;
    player?.close();
    frame?.remove();
    close?.remove();
    player = frame = close = opening = desired = null;
    controls.hidden = false;
    play.disabled = false;
  }

  const publish = trackPlayback(host, online.embed, (state, seek) => {
    if (!state.opened) {
      detach();
      clear();
      return;
    }
    desired = { state, seek: seek || desired?.seek };
    if (player) apply();
    else mount();
  }, detach);

  function apply() {
    if (!desired) return;
    player.apply(desired.state, desired.seek);
    desired = null;
  }

  function read(state, options) {
    if (![state.time, state.rate, state.volume].every(Number.isFinite)) return;
    if (state.playing) clear();
    if (observe) publish({ ...state, opened: true }, options);
  }

  function trouble(reason) {
    report(reason === 'blocked'
      ? 'Press play in the video player to continue.'
      : 'The video provider could not play this video.');
  }

  async function mount() {
    if (opening) return;
    const ticket = ++generation;
    opening = true;
    play.disabled = true;
    try {
      const url = new URL(online.embed);
      const youtube = online.provider === 'YouTube';
      let src;
      if (youtube) {
        const id = url.pathname.split('/').pop();
        if (isTauri()) src = await invoke('youtube_player_url', { id });
        else {
          const wrapper = new URL('youtube-player.html', location.href);
          wrapper.hash = new URLSearchParams({ id });
          src = wrapper.href;
        }
      } else {
        // Vimeo otherwise automatically pauses its matching player in the
        // other window when the second copy of this video starts.
        url.searchParams.set('autopause', '0');
        url.searchParams.set('autoplay', desired?.state.playing ? '1' : '0');
        src = url.href;
      }
      if (!host.isConnected || generation !== ticket) return;
      frame = element('iframe', 'online-player');
      frame.src = src;
      frame.title = online.provider + ' video';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.allow =
        'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      close = control('Close player', X);
      close.classList.add('close-player');
      close.onclick = (event) => {
        event.stopPropagation();
        if (observe) publish({ ...initialPlayback, playing: false, opened: false });
        detach();
        clear();
        play.focus();
      };
      close.onpointerdown = (event) => event.stopPropagation();
      host.append(frame, close);
      controls.hidden = true;
      const connected = youtube
        ? connectYouTube(frame, observe, read, trouble)
        : await connectVimeo(frame, observe, read, trouble);
      if (generation !== ticket || !host.isConnected) {
        connected?.close();
        return;
      }
      player = connected;
      if (player) apply();
    } catch {
      if (generation === ticket) {
        detach();
        trouble('error');
      }
    } finally {
      if (generation === ticket) {
        opening = false;
        play.disabled = false;
      }
    }
  }

  play.addEventListener('click', () => {
    desired = { state: { ...initialPlayback, at: Date.now() }, seek: true };
    mount();
  });
}

export function videoNode(o, assets, interactive = false, deferImages = false) {
  const host = element('div', 'video-surface');
  host.dataset.videoId = o.id;
  const online = onlineVideo(o.embed);
  if (o.poster && assets[o.poster]) {
    const p = element('img', 'video-cover');
    p.alt = '';
    p.draggable = false;
    setImageSource(p, assets[o.poster], deferImages);
    host.append(p);
  }
  if (!interactive) return host;
  const observe = interactive !== 'present';
  const controls = element('div', 'media-controls');
  controls.dataset.mediaControl = '';
  // Keep player input out of selection, dragging and slide navigation.
  for (const event of ['pointerdown', 'click', 'dblclick', 'keydown', 'keyup'])
    controls.addEventListener(event, (event) => event.stopPropagation());
  const feedback = element('div', 'video-feedback');
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  const report = (message) => {
    feedback.textContent = message;
    feedback.hidden = false;
  };
  const clear = () => { feedback.hidden = true; };
  host.append(feedback);
  const play = control(online ? 'Play ' + online.provider + ' video' : 'Play video', Play);
  if (online) {
    onlineControls(host, online, controls, play, report, clear, observe);
    return host;
  }
  if (!assets[o.asset]) {
    report('Video source unavailable');
    return host;
  }
  const video = element('video', 'local-player');
  video.playsInline = true;
  video.preload = 'none';
  if (o.poster) video.poster = mediaURL(assets[o.poster]);
  const seek = slider('Seek video', 0.01, 1),
    volume = slider('Volume', 0.01, 1),
    mute = control('Mute', Volume2);
  seek.className = 'video-seek';
  volume.className = 'video-volume';
  volume.value = '1';
  const stamp = element('span', 'video-time');
  stamp.textContent = '0:00';
  let ready = false, pending, starting, autoplayBlocked = false, interacted = false;

  function load() {
    if (!ready) {
      video.src = mediaURL(assets[o.asset]);
      ready = true;
    }
  }

  const publish = trackPlayback(host, o.asset, (state, move) => {
    interacted = true;
    pending = { state, move: move || pending?.move };
    load();
    apply();
  }, () => {
    video.pause();
    if (ready) {
      video.removeAttribute('src');
      video.load();
    }
  });

  function state(options) {
    if (observe && interacted)
      publish({
        opened: true,
        time: video.currentTime,
        playing: !video.paused && !video.ended,
        volume: video.volume,
        muted: video.muted,
        rate: video.playbackRate,
      }, options);
  }

  function start() {
    if (starting) return;
    starting = video.play().then(clear).catch((error) => {
      if (error.name === 'AbortError') return;
      autoplayBlocked = error.name === 'NotAllowedError';
      report(autoplayBlocked
        ? 'Press play here to enable synchronized playback.'
        : 'This video codec could not be played.');
    }).finally(() => { starting = null; });
  }

  function apply() {
    if (!pending) return;
    const { state: next, move } = pending;
    video.volume = next.volume;
    video.muted = next.muted;
    video.playbackRate = next.rate;
    if (video.readyState >= 1) {
      const target = Math.min(currentTime(next), video.duration);
      if (Number.isFinite(target) && (move || Math.abs(video.currentTime - target) > 0.45))
        video.currentTime = target;
      pending = null;
    }
    if (next.playing) {
      if (video.paused && (!autoplayBlocked || next.muted)) start();
    } else if (!video.paused) video.pause();
  }

  play.onclick = () => {
    interacted = true;
    load();
    autoplayBlocked = false;
    if (video.paused) start();
    else video.pause();
  };
  video.addEventListener('play', () => state());
  video.addEventListener('playing', () => {
    host.classList.add('playing');
    play.replaceChildren(glyph(Pause));
    play.setAttribute('aria-label', 'Pause video');
    play.title = 'Pause video';
    state();
  });
  video.addEventListener('pause', () => {
    play.replaceChildren(glyph(Play));
    play.setAttribute('aria-label', 'Play video');
    play.title = 'Play video';
    state();
  });
  video.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(video.duration)) seek.max = String(video.duration);
    apply();
  });
  video.addEventListener('timeupdate', () => {
    seek.value = String(video.currentTime);
    stamp.textContent = time(video.currentTime);
    state();
  });
  video.addEventListener('seeking', () => {
    if (video.readyState) host.classList.add('playing');
    state({ seek: true });
  });
  video.addEventListener('ended', () => state());
  video.addEventListener('ratechange', () => state());
  video.addEventListener('error', () => report('This video codec could not be played.'));
  host.addEventListener('pointerenter', () => {
    if (!ready) {
      video.preload = 'metadata';
      load();
    }
  }, { once: true });
  seek.oninput = () => {
    interacted = true;
    load();
    if (Number.isFinite(video.duration)) video.currentTime = Number(seek.value);
  };
  mute.onclick = () => {
    interacted = true;
    video.muted = !video.muted;
  };
  volume.oninput = () => {
    interacted = true;
    video.volume = Number(volume.value);
    video.muted = false;
  };
  video.onvolumechange = () => {
    const silent = video.muted || !video.volume;
    mute.replaceChildren(glyph(silent ? VolumeX : Volume2));
    mute.setAttribute('aria-label', silent ? 'Unmute' : 'Mute');
    volume.value = String(video.muted ? 0 : video.volume);
    state();
  };
  controls.append(play, seek, stamp, mute, volume);
  host.append(video, controls);
  return host;
}
