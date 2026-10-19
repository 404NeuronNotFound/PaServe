import type { HttpException } from '@nestjs/common';

export type ImageUploadFile = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

/** Filename and MIME are untrusted hints; both must agree with the bytes.
 * The original name must never be used as a storage key.
 */
export function validateImageUpload(
  file: ImageUploadFile | undefined,
  maxBytes: number,
  allowedTypes: readonly string[],
  invalid: () => HttpException,
  tooLarge: () => HttpException,
) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0)
    throw invalid();
  if (file.buffer.length > maxBytes || file.size > maxBytes) throw tooLarge();
  if (
    !Number.isSafeInteger(file.size) ||
    file.size !== file.buffer.length ||
    !allowedTypes.includes(file.mimetype) ||
    typeof file.originalname !== 'string' ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted names.
    /[\x00-\x1f\x7f/\\]/u.test(file.originalname)
  )
    throw invalid();
  const extension = /\.([a-z]+)$/iu.exec(file.originalname)?.[1].toLowerCase();
  const extensionFormat =
    extension === 'jpg' || extension === 'jpeg'
      ? 'jpeg'
      : extension === 'png' || extension === 'webp'
        ? extension
        : null;
  const buffer = file.buffer;
  // Do not send unsupported formats (including SVG) to the decoder.
  const format = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    ? 'jpeg'
    : buffer
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : buffer.toString('ascii', 0, 4) === 'RIFF' &&
          buffer.toString('ascii', 8, 12) === 'WEBP'
        ? 'webp'
        : null;
  if (
    !format ||
    extensionFormat !== format ||
    file.mimetype !== `image/${format}`
  )
    throw invalid();
  return { buffer, format };
}
