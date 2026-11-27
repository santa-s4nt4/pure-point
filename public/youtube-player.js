// This page runs in an isolated frame. The native app serves it on loopback
// so YouTube receives the HTTP Referer required by its embedded player.
(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get('id') || location.pathname.split('/').pop();
  if (!/^[\w-]{11}$/.test(id)) return;
  const message = (event, data) =>
    parent.postMessage({ type: 'pure-point-youtube', event, data }, '*');
  const frame = document.createElement('iframe');
  frame.title = 'YouTube video';
  frame.id = 'player';
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  const url = new URL('https://www.youtube.com/embed/' + id);
  url.searchParams.set('enablejsapi', '1');
  url.searchParams.set('playsinline', '1');
  url.searchParams.set('origin', location.origin);
  const app = params.get('app');
  if (/^[\w.-]+$/.test(app || ''))
    url.searchParams.set('widget_referrer', 'https://' + app + '/');
  frame.src = url.href;
  document.body.append(frame);
  let player, timer;

  function report() {
    if (!player) return;
    const status = player.getPlayerState();
    message('state', {
      time: player.getCurrentTime(),
      playing: status === 1 || status === 3,
      buffering: status === 3,
      volume: player.getVolume() / 100,
      muted: player.isMuted(),
      rate: player.getPlaybackRate(),
    });
  }
  window.onYouTubeIframeAPIReady = () => {
    new window.YT.Player(frame, {
      events: {
        onReady(e) {
          player = e.target;
          message('ready');
        },
        onStateChange: report,
        onPlaybackRateChange: report,
        onAutoplayBlocked: () => message('blocked'),
        onError: () => message('error'),
      },
    });
  };
  addEventListener('message', (event) => {
    const { type, observe, playback, seek } = event.data || {};
    if (event.source !== parent || type !== 'pure-point-youtube-control' || !player)
      return;
    if (observe && !timer) timer = setInterval(report, 125);
    if (!playback) return;
    const { time, playing, buffering, volume, muted, rate, at } = playback;
    if (![time, volume, rate, at].every(Number.isFinite)) return;
    const seconds = time + (playing && !buffering ? Math.max(0, Date.now() - at) / 1000 * rate : 0);
    if (player.getVolume() !== Math.round(volume * 100)) player.setVolume(Math.round(volume * 100));
    if (player.isMuted() !== muted) {
      if (muted) player.mute();
      else player.unMute();
    }
    if (rate !== player.getPlaybackRate()) player.setPlaybackRate(rate);
    if (seek || Math.abs(seconds - player.getCurrentTime()) > 0.45) player.seekTo(seconds, true);
    const status = player.getPlayerState();
    if (playing && status !== 1 && status !== 3) player.playVideo();
    if (!playing && (status === 1 || status === 3)) player.pauseVideo();
  });
  const api = document.createElement('script');
  api.src = 'https://www.youtube.com/iframe_api';
  api.onerror = () => message('error');
  document.head.append(api);
})();
