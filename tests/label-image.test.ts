import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeLabelImageDataUrl} from '../label-image.ts';

// A small, publicly-known 1×1 transparent PNG. No customer information.
export const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlNiS4AAAAASUVORK5CYII=';
const url = (type: string, bytes: Buffer) => `data:image/${type};base64,${bytes.toString('base64')}`;

test('accepts a small PNG and reports exact metadata', () => {
  const image = decodeLabelImageDataUrl('data:image/png;base64,' + tinyPng);
  assert.equal(image.mime, 'image/png');
  assert.equal(image.extension, 'png');
  assert.equal(image.width, 1);
  assert.equal(image.height, 1);
  assert.deepEqual(image.bytes, Buffer.from(tinyPng, 'base64'));
});

test('rejects spoofed MIME, empty, damaged and noncanonical base64', () => {
  const png = Buffer.from(tinyPng, 'base64');
  assert.throws(() => decodeLabelImageDataUrl(url('jpeg', png)), /JPEG/);
  assert.throws(() => decodeLabelImageDataUrl('data:image/png;base64,'), /base64/);
  assert.throws(() => decodeLabelImageDataUrl('data:image/svg+xml;base64,' + tinyPng), /base64/);
  assert.throws(() => decodeLabelImageDataUrl('data:image/png;base64,@@@@'), /base64/);
  assert.throws(() => decodeLabelImageDataUrl('data:image/png;base64,AAAA='), /encoding/);
  assert.throws(() => decodeLabelImageDataUrl(null), /PNG, JPEG or WebP/);
  assert.throws(() => decodeLabelImageDataUrl(url('png', png.subarray(0, 24))), /PNG/);
  const mismatched = Buffer.from(png);
  mismatched[0] = 0;
  assert.throws(() => decodeLabelImageDataUrl(url('png', mismatched)), /PNG/);
});

test('rejects oversized byte buffers and excessive decoded pixel dimensions', () => {
  const huge = Buffer.alloc(2_000_001);
  assert.throws(() => decodeLabelImageDataUrl(url('png', huge)), /oversized|2 MB/);
  const png = Buffer.from(tinyPng, 'base64');
  png.writeUInt32BE(12_001, 16);
  assert.throws(() => decodeLabelImageDataUrl(url('png', png)), /dimensions/);
  png.writeUInt32BE(6_001, 16);
  png.writeUInt32BE(6_001, 20);
  assert.throws(() => decodeLabelImageDataUrl(url('png', png)), /dimensions/);
});

test('recognizes JPEG and WebP metadata headers but does not claim full decoding', () => {
  // Minimal header envelopes exercise format parsing. They are NOT full
  // decodable pictures; production use must perform an actual image decode.
  const jpeg = Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,0,10,0,20,1,1,0x11,0,0xff,0xd9]);
  const j = decodeLabelImageDataUrl(url('jpeg', jpeg));
  assert.deepEqual([j.width, j.height], [20, 10]);
  const webp = Buffer.alloc(30);
  webp.write('RIFF'); webp.writeUInt32LE(22, 4);
  webp.write('WEBP', 8); webp.write('VP8 ', 12); webp.writeUInt32LE(10, 16);
  webp[23] = 0x9d; webp[24] = 0x01; webp[25] = 0x2a;
  webp.writeUInt16LE(64, 26); webp.writeUInt16LE(32, 28);
  const w = decodeLabelImageDataUrl(url('webp', webp));
  assert.deepEqual([w.width, w.height], [64, 32]);
  const broken = Buffer.from(webp);
  broken.writeUInt32LE(999, 16);
  assert.throws(() => decodeLabelImageDataUrl(url('webp', broken)), /Truncated/);
});

test('rejects animated WebP labels', () => {
  const webp = Buffer.alloc(30);
  webp.write('RIFF');webp.writeUInt32LE(22,4);webp.write('WEBP',8);
  webp.write('VP8X',12);webp.writeUInt32LE(10,16);
  webp[20]=0x02;
  assert.throws(() => decodeLabelImageDataUrl(url('webp',webp)), /Animated/);
});
