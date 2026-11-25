import { uid } from './model.js';
import { retainMovies, releaseMovies } from './platform.js';

// Asset paths are only meaningful inside the PPTX package they came from.
// Nested pictures, posters and movies may refer to the same physical part.
function mediaReferences(items, visit) {
  for (const item of items) {
    if (item.kind === 'image' || item.kind === 'video') {
      if (item.asset) visit(item, 'asset');
      if (item.kind === 'video' && item.poster) visit(item, 'poster');
    }
    if (item.items) mediaReferences(item.items, visit);
  }
}
export function captureClipboardMedia(items, sourceAssets) {
  const assets = Object.create(null);
  mediaReferences(items, (item, key) => {
    const path = item[key];
    if (!Object.hasOwn(sourceAssets, path))
      throw Error('The source media is unavailable: ' + path);
    assets[path] = sourceAssets[path];
  });
  retainMovies(Object.values(assets));
  return { assets };
}
export function pasteClipboardMedia(clonedItems, capture, destinationAssets) {
  const identity = (value) => value?.token || value;
  const existing = new Map(
    Object.entries(destinationAssets).map(([path, value]) => [
      identity(value),
      path,
    ])
  );
  const changes = [];
  const additions = Object.create(null);
  mediaReferences(clonedItems, (item, key) => {
    const source = item[key],
      asset = capture?.assets?.[source];
    if (!asset) throw Error('The copied media is no longer available.');
    const id = identity(asset);
    let path =
      identity(destinationAssets[source]) === id ? source : existing.get(id);
    if (!path) {
      const ext =
        source.match(/\.([a-z\d]{1,8})$/i)?.[1].toLowerCase() || 'bin';
      path = 'ppt/media/pure-point-' + uid() + '.' + ext;
      additions[path] = asset;
      existing.set(id, path);
    }
    changes.push([item, key, path]);
  });
  retainMovies(Object.values(additions));
  Object.assign(destinationAssets, additions);
  for (const [item, key, path] of changes) item[key] = path;
}
export function releaseClipboardMedia(capture) {
  if (!capture?.assets) return Promise.resolve();
  const values = Object.values(capture.assets);
  capture.assets = null;
  return releaseMovies(values);
}
