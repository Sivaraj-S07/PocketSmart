import { imageSize } from 'image-size';

export class HttpError extends Error {
  constructor(status, detail) {
    super(typeof detail === 'string' ? detail : 'HTTP error');
    this.status = status;
    this.detail = detail;
  }
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;

/** Validate a base64 outfit image -> [Buffer, mimeType] (or [null, null] when absent). */
export function decodeImage(encoded) {
  if (!encoded) return [null, null];
  const invalid = () => new HttpError(422, 'The outfit image is not a valid supported image');
  // Strict base64 (Python's b64decode(validate=True)): alphabet only, correct padding.
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw invalid();
  const data = Buffer.from(encoded, 'base64');
  if (data.length > MAX_BYTES) throw new HttpError(413, 'Outfit image must be 5 MB or smaller');
  let info;
  try {
    info = imageSize(data);
  } catch {
    throw invalid();
  }
  if (!info.width || !info.height) throw invalid();
  if (info.width * info.height > MAX_PIXELS) throw new HttpError(413, 'Outfit image dimensions are too large');
  const mime = MIME[info.type];
  if (!mime) throw new HttpError(415, 'Use a JPEG, PNG, or WebP outfit image');
  return [data, mime];
}
