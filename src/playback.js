const players = new WeakMap();
let editorSilenced = false;

export function isEditorAudioSilenced() {
  return editorSilenced;
}

export function silenceEditorAudio(silenced) {
  if (silenced === editorSilenced) return;
  editorSilenced = silenced;
  for (const host of document.querySelectorAll('.video-surface'))
    players.get(host)?.silenceAudio?.(silenced);
}

export function currentTime(state) {
  const advances = state.playing && !state.buffering;
  const elapsed = Math.max(0, Date.now() - state.at) / 1000;
  return state.time + (advances ? elapsed * state.rate : 0);
}

export function trackPlayback(host, source, apply, dispose, silenceAudio) {
  let state, received;
  let seek = 0;
  const session = {
    source,
    state: () => state,
    apply(next) {
      if (!next) return;
      const signature = JSON.stringify(next);
      if (received?.signature === signature) return;
      const moved = next.seek !== received?.seek;
      received = { signature, seek: next.seek };
      apply(next, moved);
    },
    dispose,
    silenceAudio,
  };
  players.set(host, session);
  return (next, options = {}) => {
    if (!host.isConnected) return;
    const before = state;
    const now = Date.now();
    const jumped = before && !next.buffering &&
      Math.abs(currentTime(before) - next.time) > (next.playing ? 0.5 : 0.05);
    if (options.seek || (options.detectSeek && jumped)) seek++;
    const updated = !before || before.playing !== next.playing ||
      before.opened !== next.opened || before.buffering !== next.buffering ||
      before.muted !== next.muted ||
      before.volume !== next.volume || before.rate !== next.rate ||
      before.seek !== seek || (next.playing && now - before.at >= 1000);
    if (!updated) return;
    state = { ...next, at: now, seek };
    host.dispatchEvent(new Event('video-playback', { bubbles: true }));
  };
}

export function slidePlayback(scene) {
  if (!scene) return [];
  return Array.from(scene.querySelectorAll('.video-surface')).flatMap((host) => {
    const player = players.get(host);
    const state = player?.state();
    return state ? [{ id: host.dataset.videoId, source: player.source, state }] : [];
  });
}

export function applyPlayback(scene, state) {
  if (!scene || !state?.length) return;
  const byId = new Map(state.map((entry) => [entry.id, entry]));
  for (const host of scene.querySelectorAll('.video-surface')) {
    const next = byId.get(host.dataset.videoId);
    const player = players.get(host);
    if (next && player?.source === next.source) player.apply(next.state);
  }
}

// Keep same-source video frames in the document during ordinary redraws.
export function replaceLiveScene(container, next, slideId) {
  const old = container.firstElementChild;
  next.dataset.slideId = slideId;
  if (!old?.classList.contains('scene') || old.dataset.slideId !== slideId ||
      !old.querySelector('.video-surface')) {
    disposePlayback(old);
    container.replaceChildren(next);
    return;
  }
  old.style.cssText = next.style.cssText;
  copyWithPlayers(old, next);
  while (old.nextElementSibling) old.nextElementSibling.remove();
}

export function disposePlayback(root) {
  for (const video of root?.querySelectorAll('.video-surface') || [])
    players.get(video)?.dispose();
}

function matchesPlayer(old, next) {
  if (!old || !next) return false;
  const before = players.get(old), after = players.get(next);
  return Boolean(before && after && before.source === after.source);
}

function keepPlayerBranch(old, next) {
  if (next.hidden) return false;
  const before = old.querySelector(':scope > .video-surface');
  const after = next.querySelector(':scope > .video-surface');
  if (matchesPlayer(before, after)) return true;
  return Boolean(old.querySelector('.video-surface') &&
    old.querySelector(':scope > .group-content') &&
    next.querySelector(':scope > .group-content'));
}

function updatePlayerBranch(existing, fresh) {
  existing.style.cssText = fresh.style.cssText;
  existing.hidden = fresh.hidden;
  existing.className = fresh.className;
  const inner = existing.querySelector(':scope > .group-content');
  if (!inner) return;
  const replacement = fresh.querySelector(':scope > .group-content');
  inner.style.cssText = replacement.style.cssText;
  copyWithPlayers(inner, replacement);
}

export function replaceLiveItem(old, fresh) {
  if (!old) return;
  if (keepPlayerBranch(old, fresh)) updatePlayerBranch(old, fresh);
  else {
    disposePlayback(old);
    old.replaceWith(fresh);
  }
}

function copyWithPlayers(old, next) {
  const oldItems = new Map();
  for (const node of old.children)
    if (node.dataset.id) oldItems.set(node.dataset.id, node);
  const incoming = Array.from(next.children, (fresh) => {
    const existing = oldItems.get(fresh.dataset.id);
    return { fresh, existing: existing && keepPlayerBranch(existing, fresh) ? existing : null };
  });
  const kept = new Set(incoming.map(({ existing }) => existing));
  for (const node of [...old.children]) {
    if (kept.has(node)) continue;
    disposePlayback(node);
    node.remove();
  }
  let cursor = old.firstElementChild;
  for (const { fresh, existing } of incoming) {
    if (!existing) {
      old.insertBefore(fresh, cursor);
      continue;
    }
    if (existing !== cursor) {
      // A stack-order change can reparent the layer. For affected players,
      // restore playback state when the browser has to recreate the iframe.
      const state = slidePlayback(existing);
      disposePlayback(existing);
      existing.remove();
      old.insertBefore(fresh, cursor);
      applyPlayback(fresh, state);
      continue;
    }
    cursor = existing.nextElementSibling;
    updatePlayerBranch(existing, fresh);
  }
}
