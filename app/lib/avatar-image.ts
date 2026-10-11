import "server-only";

import sharp from "sharp";

// Profile pictures (SUP-23): every upload is decoded and re-encoded here
// before it is stored -- and only the server can write to the bucket
// (app/lib/db/avatars.ts) -- so it only holds small WebP squares: no
// large originals, no SVG (scriptable), and no EXIF metadata such as a
// phone's GPS position (sharp drops metadata unless asked to keep it).

export const AVATAR_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const AVATAR_SIZE = 256;

const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class AvatarImageError extends Error {
  constructor(readonly reason: "too_large" | "unsupported") {
    super(`avatar image refused: ${reason}`);
  }
}

export async function toAvatarWebp(input: Buffer): Promise<Buffer> {
  if (input.byteLength > AVATAR_MAX_UPLOAD_BYTES) {
    throw new AvatarImageError("too_large");
  }
  // The format comes from the file's own bytes, not its name or the
  // browser's Content-Type. limitInputPixels stops a tiny file that
  // decodes to an enormous canvas (a "decompression bomb").
  const image = sharp(input, { limitInputPixels: 25_000_000 });
  let format: string | undefined;
  try {
    format = (await image.metadata()).format;
  } catch {
    throw new AvatarImageError("unsupported");
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) {
    throw new AvatarImageError("unsupported");
  }
  try {
    return await image
      .rotate() // honour the EXIF orientation before it is dropped
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new AvatarImageError("unsupported");
  }
}
