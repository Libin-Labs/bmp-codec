# @lp-labs/bmp-codec

Bounded decoder and encoder for uncompressed 24-bit Windows bitmaps (BI_RGB): real BMP file and DIB headers, 4-byte row stride padding, and bottom-up/top-down row orientation. Indexed, RLE, bitfield and 32-bit variants are rejected explicitly.

## Install

```sh
npm install @lp-labs/bmp-codec
```

Node.js 18+; standalone ES2022 core with DOM-library types only. Zero runtime or peer dependencies. ESM and CommonJS builds with separate declarations. No filesystem, network, timer or environment access: every function works on in-memory bytes or strings you provide.

## Quickstart

```js
import { decodeBmp, encodeBmp } from '@lp-labs/bmp-codec';
const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
const file = encodeBmp({ width: 3, height: 1, data: rgba });
const image = decodeBmp(file);
console.log(file.length, image.width, image.height, [...image.data.slice(0, 4)]);
```

CommonJS consumers use `const api = require('@lp-labs/bmp-codec')`. The same named API is available in both module formats. No default export.

## API, behavior and options

`decodeBmp(bytes, options?)` returns `{ width, height, data, topDown }`. `data` is a new top-to-bottom RGBA `Uint8ClampedArray` (alpha 255). `topDown` reports how rows were stored; pixels are always returned in visual order, so you never flip rows yourself.

`encodeBmp({ width, height, data }, options?)` takes visual-order RGBA (any numeric array-like, length exactly width*height*4) and writes a 14-byte file header, a 40-byte BITMAPINFOHEADER, then BGR rows padded to a multiple of 4 bytes. Alpha is discarded and channel values are rounded and clamped to 0-255. `topDown: true` stores a negative height and top-first rows.

Decoder accepts DIB headers of 40, 52, 56, 108 and 124 bytes (INFO, V2, V3, V4, V5) but only reads the INFO fields; color-space data in V4/V5 is ignored. The pixel offset from the file header is honored and may exceed the header size. The file-size field and reserved fields are not trusted; bytes after the pixel array are ignored; row padding bytes are ignored. Options: `maxPixels` (default 67,108,864) and `maxBytes` (default 268,435,456), both validated as positive safe integers.

All exports: `BmpImage`, `BmpDecodeOptions`, `BmpEncodeOptions`, `BmpPixels`, `BmpErrorCode`, `BmpError`, `decodeBmp`, `encodeBmp`.

## Full TypeScript declarations

```ts
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
export declare class BmpError extends Error {
  readonly code: BmpErrorCode;
  readonly offset: number | undefined;
  constructor(code: BmpErrorCode, message: string, offset?: number);
}
/** Decodes an uncompressed 24-bit BI_RGB Windows bitmap (BITMAPINFOHEADER or larger V4/V5). */
export declare function decodeBmp(input: Uint8Array, options?: BmpDecodeOptions): BmpImage;
/** Encodes RGBA pixels as an uncompressed 24-bit BI_RGB BMP (alpha discarded). */
export declare function encodeBmp(image: BmpPixels, options?: BmpEncodeOptions): Uint8Array;
```

## Examples

### Top-down files

```js
import { decodeBmp, encodeBmp } from '@lp-labs/bmp-codec';
const data = [1, 2, 3, 255, 4, 5, 6, 255];
const file = encodeBmp({ width: 1, height: 2, data }, { topDown: true });
const image = decodeBmp(file);
console.log(image.topDown, [...image.data].join());
```

### Rejecting unsupported variants

```js
import { BmpError, decodeBmp, encodeBmp } from '@lp-labs/bmp-codec';
const file = encodeBmp({ width: 1, height: 1, data: [0, 0, 0, 255] });
file[28] = 8; // pretend it is an 8-bit indexed bitmap
try {
  decodeBmp(file);
} catch (error) {
  console.log(error instanceof BmpError, error.code, error.offset);
}
```

## Customization

There are no global settings. Tighten `maxPixels` and `maxBytes` for untrusted uploads; both are checked before any pixel allocation. Convert to your own pixel type by wrapping `image.data` (for example `new ImageData(image.data, image.width, image.height)` in a browser). To support other depths, decode them yourself and pass RGBA to `encodeBmp`.

## Errors

Malformed input throws `BmpError` with `code` (`'truncated'`, `'bad-signature'`, `'bad-header'`, `'unsupported'`, `'limit'`) and, when known, the byte `offset` of the offending field. Wrong argument types or invalid limits/encoder inputs throw `TypeError` / `RangeError`. Decoding never returns partial results.

## Performance

Decoding and encoding are single linear passes over the pixels and allocate one output buffer. Dimensions, stride and length arithmetic is checked before allocation, so a tiny file declaring a giant image fails fast. Memory is about 4 bytes per pixel for decoded RGBA.

## Scope and non-goals

Supported: BI_RGB, 24 bits per pixel, one plane, both row orders. Rejected explicitly: bit depths 1/4/8 (palettes), 15/16/32 bits, BI_RLE4/BI_RLE8/BI_BITFIELDS/JPEG/PNG compression, OS/2 12-byte core headers. Not provided: ICC color management, DPI interpretation (the encoder writes 72 DPI), alpha, gamma, or file I/O. Verified against bitmaps written by Pillow.

## Development

```sh
npm ci --offline
npm run typecheck
npm test
npm run format:check
```

TypeScript ^5.9.3 and Prettier ^3.6.2 are development-only. Build emits dist/esm and dist/cjs. Tests use Node's test runner; consumer.mts and consumer.cts exercise bare package imports including negative type assertions.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
