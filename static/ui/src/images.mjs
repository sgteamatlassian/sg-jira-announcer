// Uploaded pictures are shrunk in the browser until they fit into one Forge
// storage value: scaled down to `maxSide` pixels, then saved as PNG (keeps
// transparency, best for logos), else WebP, else JPEG, getting smaller until
// the data URL is short enough.

export const MAX_IMAGE_CHARS = 200 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

export const IMAGE_ACCEPT = ACCEPTED.join(',');

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The file is not a picture this browser can open.'));
    image.src = src;
  });
}

// Width and height scaled so that the longer side is at most `maxSide`.
export function fitSize(width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function encode(image, width, height, type, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (type === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); }
  context.drawImage(image, 0, 0, width, height);
  const url = canvas.toDataURL(type, quality);
  // Browsers that cannot write a type silently give PNG instead.
  return url.startsWith(`data:${type};`) ? url : null;
}

export async function shrinkImage(file, { maxSide = 1400, maxChars = MAX_IMAGE_CHARS } = {}) {
  if (!ACCEPTED.includes(file.type)) throw new Error('Please choose a PNG, JPEG, WebP, GIF or SVG picture.');
  if (file.size > 20 * 1024 * 1024) throw new Error('The picture is larger than 20 MB.');
  const image = await loadImage(await readAsDataUrl(file));
  const natural = { width: image.naturalWidth || 800, height: image.naturalHeight || 600 };
  let side = Math.max(natural.width, natural.height, 1);
  side = Math.min(side, maxSide);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { width, height } = fitSize(natural.width, natural.height, side);
    // Tried in order, each only when the previous one was too large.
    const tries = [
      ['image/png'],
      ...[0.9, 0.8, 0.7, 0.6].map(quality => ['image/webp', quality]),
      ...[0.85, 0.75, 0.6].map(quality => ['image/jpeg', quality])
    ];
    for (const [type, quality] of tries) {
      const url = encode(image, width, height, type, quality);
      if (url && url.length <= maxChars) return { dataUrl: url, width, height };
    }
    side = Math.round(side * 0.75);
  }
  throw new Error('The picture could not be made small enough. Please use a smaller picture.');
}
