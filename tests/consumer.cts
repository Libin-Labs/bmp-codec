import { BmpError, decodeBmp, encodeBmp, type BmpImage, type BmpPixels } from '@lp-labs/bmp-codec';
const pixels: BmpPixels = { width: 1, height: 1, data: [1, 2, 3, 255] };
const bytes: Uint8Array = encodeBmp(pixels, { topDown: true });
const image: BmpImage = decodeBmp(bytes, { maxPixels: 10 });
const error: BmpError = new BmpError('limit', 'x');
void [image.data, image.topDown, error.code];
// @ts-expect-error input must be bytes
decodeBmp('text');
// @ts-expect-error image is read-only
image.width = 2;
