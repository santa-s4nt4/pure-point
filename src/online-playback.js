import { currentTime } from './playback.js';

export function connectYouTube(frame, observe, onReport, onError) {
  const origin = new URL(frame.src).origin;
  const send = (payload) =>
    frame.contentWindow?.postMessage({ type: 'pure-point-youtube-control', ...payload }, origin);
  let ready = false, pending;
  function receive(event) {
    if (event.source !== frame.contentWindow || event.origin !== origin ||
        event.data?.type !== 'pure-point-youtube') return;
    const { event: kind, data } = event.data;
    if (kind === 'ready') {
      ready = true;
      send({ observe, ...pending });
    } else if (kind === 'state' && observe && data) {
      onReport(data, { detectSeek: true });
    } else if (kind === 'error' || kind === 'blocked') onError(kind);
  }
  window.addEventListener('message', receive);
  return {
    apply(playback, seek) {
      pending = { playback, seek };
      if (ready) send(pending);
    },
    close: () => window.removeEventListener('message', receive),
  };
}

export async function connectVimeo(frame, observe, onReport, onError) {
  const { default: Player } = await import('@vimeo/player');
  if (!frame.isConnected) return null;
  const player = new Player(frame);
  let closed = false, pending, running = false, ready = false;
  let state = { time: 0, playing: false, volume: 1, muted: false, rate: 1 };
  const emit = (change, options) => {
    state = { ...state, ...change };
    if (!closed && observe) onReport(state, options);
  };
  const events = {
    play: ({ seconds }) => emit({ time: seconds, playing: true }),
    pause: ({ seconds }) => emit({ time: seconds, playing: false }),
    ended: ({ seconds }) => emit({ time: seconds, playing: false }),
    timeupdate: ({ seconds }) => emit({ time: seconds }),
    seeked: ({ seconds }) => emit({ time: seconds }, { seek: true }),
    playbackratechange: ({ playbackRate }) => emit({ rate: playbackRate }),
    volumechange({ volume }) {
      emit({ volume });
      player.getMuted().then((muted) => emit({ muted })).catch(() => {});
    },
    error: () => onError('error'),
  };
  for (const [event, listener] of Object.entries(events))
    if (observe || event === 'error') player.on(event, listener);

  async function update() {
    if (running || !ready || closed) return;
    running = true;
    try {
      while (pending && !closed) {
        const { playback, seek } = pending;
        pending = null;
        // Apply only controls which changed. Repeated updates do not reset a
        // playing video to the old timestamp when another layer is edited.
        const [paused, time, volume, muted, rate] = await Promise.all([
          player.getPaused(), player.getCurrentTime(), player.getVolume(),
          player.getMuted(), player.getPlaybackRate(),
        ]);
        if (closed) break;
        if (pending) {
          pending.seek ||= seek;
          continue;
        }
        const actions = [];
        if (volume !== playback.volume) actions.push(player.setVolume(playback.volume));
        if (muted !== playback.muted) actions.push(player.setMuted(playback.muted));
        if (rate !== playback.rate) actions.push(player.setPlaybackRate(playback.rate));
        const target = currentTime(playback);
        if (seek || Math.abs(time - target) > 0.45)
          actions.push(player.getDuration().then((duration) => player.setCurrentTime(Math.min(target, duration))));
        await Promise.allSettled(actions);
        if (closed || pending) continue;
        if (playback.playing && paused)
          await player.play().catch(() => onError('blocked'));
        else if (!playback.playing && (!paused || actions.length))
          await player.pause().catch(() => {});
      }
    } catch {
      if (!closed) onError('error');
    } finally {
      running = false;
    }
  }

  player.ready().then(async () => {
    if (closed) return;
    ready = true;
    if (pending) update();
    if (!observe) return;
    const [time, paused, volume, muted, rate] = await Promise.all([
      player.getCurrentTime(), player.getPaused(), player.getVolume(),
      player.getMuted(), player.getPlaybackRate(),
    ]);
    if (!closed) emit({ time, playing: !paused, volume, muted, rate });
  }).catch(() => {
    if (!closed) onError('error');
  });
  return {
    apply(playback, seek) {
      pending = { playback, seek: seek || pending?.seek };
      update();
    },
    close() {
      closed = true;
      player.destroy().catch(() => {});
    },
  };
}
