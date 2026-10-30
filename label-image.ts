/**
 * Bounded, dependency-free header checks for outside-label image uploads.
 *
 * These are format/metadata checks, NOT complete image decoding, malware
 * scanning, EXIF sanitization or a guarantee that a file is safe to process
 * with a production image pipeline. Keep uploads restricted to demo data.
 */
const MAX_BYTES = 2_000_000;
const MAX_DIMENSION = 12_000;
const MAX_PIXELS = 36_000_000;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SOF = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);

type ImageType = 'png' | 'jpeg' | 'webp';
export type CheckedLabelImage = {
  bytes: Buffer;
  mime: `image/${ImageType}`;
  extension: ImageType;
  width: number;
  height: number;
};

function fail(message: string): never {
  throw new Error(message);
}

function pngDimensions(b: Buffer): [number, number] {
  if (b.length < 45 || !b.subarray(0, 8).equals(PNG_MAGIC) ||
      b.readUInt32BE(8) !== 13 || b.toString('ascii', 12, 16) !== 'IHDR' ||
      b.readUInt32BE(b.length - 12) !== 0 ||
      b.toString('ascii', b.length - 8, b.length - 4) !== 'IEND') {
    fail('Invalid PNG image structure');
  }
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function jpegDimensions(b: Buffer): [number, number] {
  if (b.length < 12 || b[0] !== 0xff || b[1] !== 0xd8 ||
      b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) {
    fail('Invalid JPEG image structure');
  }
  let offset = 2;
  while (offset < b.length - 2) {
    if (b[offset] !== 0xff) fail('Invalid JPEG marker');
    while (b[offset] === 0xff) offset++;
    if (offset >= b.length - 2) break;
    const marker = b[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > b.length) fail('Truncated JPEG segment');
    const segmentLength = b.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > b.length) fail('Truncated JPEG segment');
    if (SOF.has(marker)) {
      if (segmentLength < 7) fail('Invalid JPEG frame header');
      return [b.readUInt16BE(offset + 5), b.readUInt16BE(offset + 3)];
    }
    offset += segmentLength;
  }
  fail('JPEG dimensions unavailable');
}

function webpDimensions(b: Buffer): [number, number] {
  if (b.length < 25 || b.toString('ascii', 0, 4) !== 'RIFF' ||
      b.toString('ascii', 8, 12) !== 'WEBP' ||
      b.readUInt32LE(4) + 8 !== b.length) {
    fail('Invalid WebP image structure');
  }
  const type = b.toString('ascii', 12, 16);
  const chunkSize = b.readUInt32LE(16);
  if (20 + chunkSize + (chunkSize % 2) > b.length) fail('Truncated WebP image data');
  if (type === 'VP8X') {
    if (chunkSize < 10) fail('Invalid extended WebP header');
    if (b[20] & 0x02) fail('Animated labels are not supported');
    const width = 1 + b[24] + (b[25] << 8) + (b[26] << 16);
    const height = 1 + b[27] + (b[28] << 8) + (b[29] << 16);
    return [width, height];
  }
  if (type === 'VP8L') {
    if (chunkSize < 5 || b[20] !== 0x2f) fail('Invalid lossless WebP header');
    return [
      1 + (b[21] | ((b[22] & 0x3f) << 8)),
      1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10))
    ];
  }
  if (type === 'VP8 ') {
    if (chunkSize < 10 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) {
      fail('Invalid WebP frame header');
    }
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  }
  fail('Unsupported WebP image format');
}

export function decodeLabelImageDataUrl(input: unknown): CheckedLabelImage {
  if (typeof input !== 'string') fail('Use a PNG, JPEG or WebP image');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (!match) fail('Use a PNG, JPEG or WebP base64 image');
  const type = match[1] as ImageType, encoded = match[2];
  if (encoded.length % 4 !== 0 || encoded.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) {
    fail('Invalid or oversized image encoding');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_BYTES) fail('Image must be 1 byte to 2 MB');
  if (bytes.toString('base64') !== encoded) fail('Invalid image base64 encoding');
  const [width, height] = type === 'png' ? pngDimensions(bytes) :
    type === 'jpeg' ? jpegDimensions(bytes) : webpDimensions(bytes);
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION ||
      width * height > MAX_PIXELS) {
    fail('Image dimensions exceed safe demo limits');
  }
  return {bytes, mime: `image/${type}`, extension: type, width, height};
}
