// Keep video IDs and Vimeo's private-link hash, never arbitrary iframe markup.
export function onlineVideo(input) {
  let address = String(input || '').trim();
  if (address.startsWith('<')) {
    const doc = new DOMParser().parseFromString(address, 'text/html');
    address = doc.querySelector('iframe')?.getAttribute('src') || '';
  }
  let url;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (
    [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'youtu.be',
      'www.youtube-nocookie.com',
    ].includes(host)
  ) {
    const id =
      host === 'youtu.be'
        ? parts[0]
        : parts[0] === 'watch'
          ? url.searchParams.get('v')
          : ['embed', 'shorts', 'live'].includes(parts[0])
            ? parts[1]
            : null;
    if (!/^[\w-]{11}$/.test(id || '')) return null;
    return {
      provider: 'YouTube',
      embed: 'https://www.youtube.com/embed/' + id,
      watch: 'https://www.youtube.com/watch?v=' + id,
    };
  }
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
    const index = parts.findIndex((p) => /^\d+$/.test(p));
    if (index < 0) return null;
    const id = parts[index],
      hash = url.searchParams.get('h') || parts[index + 1];
    const privateHash = /^[a-zA-Z0-9]+$/.test(hash || '') ? hash : '';
    return {
      provider: 'Vimeo',
      embed:
        'https://player.vimeo.com/video/' +
        id +
        (privateHash ? '?h=' + privateHash : ''),
      watch: 'https://vimeo.com/' + id + (privateHash ? '/' + privateHash : ''),
    };
  }
  return null;
}

export const videoTypes = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
};
// Imported native media is served from a local, tokenized URL. Newly inserted
// images and the browser editor can still supply a data URL directly.
export const mediaURL = (asset) => asset?.url || asset || '';
export function setImageSource(img, asset, deferred, fallbackAsset) {
  const url = mediaURL(asset);
  if (!url) return;
  if (fallbackAsset) {
    img.dataset.fallbackSrc = mediaURL(fallbackAsset);
    if (!deferred)
      img.addEventListener(
        'error',
        () => {
          img.src = img.dataset.fallbackSrc;
        },
        { once: true }
      );
  }
  if (deferred) img.dataset.printSrc = url;
  else img.src = url;
}
export function mediaMime(path) {
  const ext = path.split('.').pop().toLowerCase();
  const image = {
    png: 'png',
    jpg: 'jpeg',
    jpeg: 'jpeg',
    gif: 'gif',
    webp: 'webp',
    bmp: 'bmp',
    svg: 'svg+xml',
  }[ext];
  return image ? 'image/' + image : videoTypes[ext];
}
