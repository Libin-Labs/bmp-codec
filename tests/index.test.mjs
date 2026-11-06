import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BmpError, decodeBmp, encodeBmp } from '../dist/esm/index.js';

// Produced by Pillow 12 (Image.save(..., 'BMP')) for the 3x2 image below.
const PIL_HEX =
  '424d4e0000000000000036000000280000000300000002000000010018000000000018000000c40e0000c40e000000000000000000001e140a3c3228fcfbfa0000000000ff00ff00ff0000000000';
const bytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex'));
const PIXELS = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [10, 20, 30, 255],
  [40, 50, 60, 255],
  [250, 251, 252, 255],
].flat();

function make({
  width = 1,
  height = 1,
  bits = 24,
  compression = 0,
  header = 40,
  planes = 1,
  offset,
  rows = [],
  sig = 'BM',
  length,
} = {}) {
  const base = 14 + header;
  const body = Uint8Array.from(rows.flat());
  const out = new Uint8Array(length ?? Math.max(54, (offset ?? base) + body.length));
  const v = new DataView(out.buffer);
  out[0] = sig.charCodeAt(0);
  out[1] = sig.charCodeAt(1);
  v.setUint32(2, out.length, true);
  v.setUint32(10, offset ?? base, true);
  v.setUint32(14, header, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, planes, true);
  v.setUint16(28, bits, true);
  v.setUint32(30, compression, true);
  if (out.length >= (offset ?? base) + body.length) out.set(body, offset ?? base);
  return out;
}

test('decodes a Pillow-produced bottom-up bitmap with row padding', () => {
  const image = decodeBmp(bytes(PIL_HEX));
  assert.equal(image.width, 3);
  assert.equal(image.height, 2);
  assert.equal(image.topDown, false);
  assert.deepEqual([...image.data], PIXELS);
});

test('encoder output equals Pillow bytes apart from the resolution fields', () => {
  const expected = bytes(PIL_HEX);
  const actual = encodeBmp({ width: 3, height: 2, data: PIXELS });
  assert.equal(actual.length, expected.length);
  assert.deepEqual(actual.slice(0, 38), expected.slice(0, 38));
  assert.deepEqual(actual.slice(46), expected.slice(46));
});

test('top-down bitmaps use a negative height and keep row order', () => {
  const encoded = encodeBmp({ width: 3, height: 2, data: PIXELS }, { topDown: true });
  assert.equal(new DataView(encoded.buffer).getInt32(22, true), -2);
  assert.deepEqual([...encoded.slice(54, 57)], [0, 0, 255]);
  const image = decodeBmp(encoded);
  assert.equal(image.topDown, true);
  assert.deepEqual([...image.data], PIXELS);
});

test('stride matrix for widths 1..9 round-trips', () => {
  for (let width = 1; width <= 9; width++) {
    const height = 3;
    const data = Array.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : (i * 37) % 256,
    );
    for (const topDown of [false, true]) {
      const encoded = encodeBmp({ width, height, data }, { topDown });
      assert.equal(encoded.length, 54 + Math.ceil((width * 3) / 4) * 4 * height);
      assert.deepEqual([...decodeBmp(encoded).data], data);
    }
  }
});

test('accepts V5 headers and ignores trailing bytes and nonzero padding', () => {
  const rows = [
    [3, 2, 1, 9],
    [6, 5, 4, 9],
  ];
  const v5 = make({ width: 1, height: 2, header: 124, rows });
  assert.deepEqual([...decodeBmp(v5).data], [4, 5, 6, 255, 1, 2, 3, 255]);
  const trailing = new Uint8Array([...v5, 7, 7, 7]);
  assert.equal(decodeBmp(trailing).height, 2);
});

test('honors the pixel data offset and rejects offsets inside the headers', () => {
  const gap = make({ width: 1, height: 1, offset: 60, rows: [[3, 2, 1, 0]] });
  assert.deepEqual([...decodeBmp(gap).data], [1, 2, 3, 255]);
  assert.throws(() => decodeBmp(make({ offset: 20, rows: [[0, 0, 0, 0]] })), BmpError);
});

test('rejects indexed, compressed, 32-bit, OS/2 and malformed headers explicitly', () => {
  const row = [[0, 0, 0, 0]];
  const cases = [
    [make({ bits: 8, rows: row }), 'unsupported'],
    [make({ bits: 32, rows: row }), 'unsupported'],
    [make({ compression: 1, rows: row }), 'unsupported'],
    [make({ compression: 3, rows: row }), 'unsupported'],
    [make({ header: 12, rows: row }), 'unsupported'],
    [make({ header: 41, rows: row }), 'unsupported'],
    [make({ sig: 'BA', rows: row }), 'bad-signature'],
    [make({ planes: 2, rows: row }), 'bad-header'],
    [make({ width: 0, rows: row }), 'bad-header'],
    [make({ width: -1, rows: row }), 'bad-header'],
    [make({ height: 0, rows: row }), 'bad-header'],
    [make({ offset: 5000, length: 100, rows: row }), 'bad-header'],
  ];
  for (const [input, code] of cases) {
    assert.throws(
      () => decodeBmp(input),
      (e) => e instanceof BmpError && e.code === code,
    );
  }
});

test('every truncation of a valid file fails with BmpError', () => {
  const full = bytes(PIL_HEX);
  for (let n = 0; n < full.length - 2; n++) {
    assert.throws(() => decodeBmp(full.slice(0, n)), BmpError, `length ${n}`);
  }
});

test('huge declared dimensions are rejected before allocation', () => {
  const huge = make({ width: 2147483647, height: 2147483647, rows: [[0, 0, 0, 0]] });
  assert.throws(
    () => decodeBmp(huge),
    (e) => e.code === 'limit',
  );
  const minHeight = make({ width: 2, height: -2147483648, rows: [[0, 0, 0, 0]] });
  assert.throws(
    () => decodeBmp(minHeight),
    (e) => e.code === 'limit',
  );
  const wide = make({ width: 100000, height: 100000, rows: [] });
  assert.throws(
    () => decodeBmp(wide, { maxPixels: 10 }),
    (e) => e.code === 'limit',
  );
  assert.throws(
    () => decodeBmp(bytes(PIL_HEX), { maxBytes: 10 }),
    (e) => e.code === 'limit',
  );
  assert.throws(
    () => decodeBmp(bytes(PIL_HEX), { maxPixels: 5 }),
    (e) => e.code === 'limit',
  );
});

test('decoded pixels are an owned copy and inputs are validated', () => {
  const input = bytes(PIL_HEX);
  const before = input.slice();
  const image = decodeBmp(input);
  image.data[0] = 0;
  assert.deepEqual(input, before);
  assert.notEqual(image.data.buffer, input.buffer);
  assert.throws(() => decodeBmp('nope'), TypeError);
  assert.throws(() => decodeBmp(input, { maxPixels: 0 }), RangeError);
  assert.throws(() => encodeBmp({ width: 2, height: 2, data: [0] }), RangeError);
  assert.throws(() => encodeBmp({ width: 1, height: 1, data: [NaN, 0, 0, 255] }), RangeError);
  assert.throws(() => encodeBmp({ width: 0, height: 1, data: [] }), RangeError);
  assert.throws(
    () => encodeBmp({ width: 9, height: 9, data: new Array(324).fill(0) }, { maxPixels: 10 }),
    RangeError,
  );
  const clamped = decodeBmp(encodeBmp({ width: 1, height: 1, data: [300, -5, 127.6, 0] }));
  assert.deepEqual([...clamped.data], [255, 0, 128, 255]);
});
