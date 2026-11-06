export interface BmpImage {
  readonly width: number;
  readonly height: number;
  /** Top-to-bottom, left-to-right RGBA bytes (alpha is always 255 when decoded). */
  readonly data: Uint8ClampedArray;
  /** True when the file stored its rows top-down (negative height). */
  readonly topDown: boolean;
}

export interface BmpDecodeOptions {
  /** Maximum width*height. Default 67,108,864. */
  maxPixels?: number;
  /** Maximum input byte length. Default 268,435,456. */
  maxBytes?: number;
}

export interface BmpEncodeOptions {
  /** Store rows top-down with a negative height. Default false (classic bottom-up). */
  topDown?: boolean;
  /** Maximum width*height. Default 67,108,864. */
  maxPixels?: number;
}

export interface BmpPixels {
  readonly width: number;
  readonly height: number;
  /** RGBA bytes, top-to-bottom. Alpha is ignored by the 24-bit encoder. */
  readonly data: ArrayLike<number>;
}

export type BmpErrorCode = 'truncated' | 'bad-signature' | 'bad-header' | 'unsupported' | 'limit';

export class BmpError extends Error {
  readonly code: BmpErrorCode;
  readonly offset: number | undefined;
  constructor(code: BmpErrorCode, message: string, offset?: number) {
    super(message);
    this.name = 'BmpError';
    this.code = code;
    this.offset = offset;
  }
}

const DEFAULT_MAX_PIXELS = 67_108_864;
const DEFAULT_MAX_BYTES = 268_435_456;
const FILE_HEADER = 14;
const INFO_HEADER = 40;

function limit(value: number | undefined, fallback: number, name: string): number {
  const v = value ?? fallback;
  if (!Number.isSafeInteger(v) || v < 1) throw new RangeError(`${name} must be a positive integer`);
  return v;
}

function stride(width: number): number {
  return Math.ceil((width * 3) / 4) * 4;
}

/** Decodes an uncompressed 24-bit BI_RGB Windows bitmap (BITMAPINFOHEADER or larger V4/V5). */
export function decodeBmp(input: Uint8Array, options: BmpDecodeOptions = {}): BmpImage {
  if (!(input instanceof Uint8Array)) throw new TypeError('input must be a Uint8Array');
  const maxPixels = limit(options.maxPixels, DEFAULT_MAX_PIXELS, 'maxPixels');
  const maxBytes = limit(options.maxBytes, DEFAULT_MAX_BYTES, 'maxBytes');
  if (input.length > maxBytes) throw new BmpError('limit', 'input exceeds maxBytes');
  if (input.length < FILE_HEADER + 4) throw new BmpError('truncated', 'file header truncated', 0);
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (input[0] !== 0x42 || input[1] !== 0x4d) throw new BmpError('bad-signature', 'missing BM', 0);
  const dataOffset = view.getUint32(10, true);
  const headerSize = view.getUint32(14, true);
  if (headerSize === 12) throw new BmpError('unsupported', 'OS/2 core header is not supported', 14);
  if (![40, 52, 56, 108, 124].includes(headerSize)) {
    throw new BmpError('unsupported', `unsupported DIB header size ${headerSize}`, 14);
  }
  if (input.length < FILE_HEADER + INFO_HEADER)
    throw new BmpError('truncated', 'DIB header truncated', 14);
  const rawWidth = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const planes = view.getUint16(26, true);
  const bitCount = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  if (planes !== 1) throw new BmpError('bad-header', 'planes must be 1', 26);
  if (rawWidth < 1 || rawHeight === 0) throw new BmpError('bad-header', 'invalid dimensions', 18);
  if (bitCount <= 8)
    throw new BmpError('unsupported', 'indexed (palette) bitmaps are not supported', 28);
  if (compression !== 0) {
    throw new BmpError(
      'unsupported',
      `compression ${compression} (RLE/bitfields) is not supported`,
      30,
    );
  }
  if (bitCount !== 24)
    throw new BmpError('unsupported', `${bitCount}-bit bitmaps are not supported`, 28);
  const topDown = rawHeight < 0;
  const width = rawWidth;
  const height = Math.abs(rawHeight);
  if (width * height > maxPixels) throw new BmpError('limit', 'image exceeds maxPixels');
  if (dataOffset < FILE_HEADER + headerSize || dataOffset > input.length) {
    throw new BmpError('bad-header', 'pixel data offset out of range', 10);
  }
  const rowBytes = stride(width);
  if (dataOffset + rowBytes * height > input.length) {
    throw new BmpError('truncated', 'pixel data truncated', dataOffset);
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const target = topDown ? row : height - 1 - row;
    let s = dataOffset + row * rowBytes;
    let d = target * width * 4;
    for (let x = 0; x < width; x++) {
      data[d] = input[s + 2]!;
      data[d + 1] = input[s + 1]!;
      data[d + 2] = input[s]!;
      data[d + 3] = 255;
      s += 3;
      d += 4;
    }
  }
  return { width, height, data, topDown };
}

/** Encodes RGBA pixels as an uncompressed 24-bit BI_RGB BMP (alpha discarded). */
export function encodeBmp(image: BmpPixels, options: BmpEncodeOptions = {}): Uint8Array {
  const maxPixels = limit(options.maxPixels, DEFAULT_MAX_PIXELS, 'maxPixels');
  const { width, height } = image;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError('width and height must be positive integers');
  }
  if (width * height > maxPixels) throw new RangeError('image exceeds maxPixels');
  if (image.data.length !== width * height * 4) {
    throw new RangeError('data length must equal width*height*4');
  }
  const rowBytes = stride(width);
  const pixelBytes = rowBytes * height;
  const total = FILE_HEADER + INFO_HEADER + pixelBytes;
  if (total > 0xffffffff || height > 0x7fffffff || width > 0x7fffffff) {
    throw new RangeError('image too large for BMP');
  }
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  view.setUint32(2, total, true);
  view.setUint32(10, FILE_HEADER + INFO_HEADER, true);
  view.setUint32(14, INFO_HEADER, true);
  view.setInt32(18, width, true);
  view.setInt32(22, options.topDown === true ? -height : height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  for (let row = 0; row < height; row++) {
    const source = options.topDown === true ? row : height - 1 - row;
    let s = source * width * 4;
    let d = FILE_HEADER + INFO_HEADER + row * rowBytes;
    for (let x = 0; x < width; x++) {
      const r = image.data[s]!;
      const g = image.data[s + 1]!;
      const b = image.data[s + 2]!;
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
        throw new RangeError('pixel samples must be finite numbers');
      }
      out[d] = Math.min(255, Math.max(0, Math.round(b)));
      out[d + 1] = Math.min(255, Math.max(0, Math.round(g)));
      out[d + 2] = Math.min(255, Math.max(0, Math.round(r)));
      s += 4;
      d += 3;
    }
  }
  return out;
}
