import sharp from "sharp";

// Next's image optimizer allows itself 7s to fetch the original from Storage
// (hardcoded AbortSignal.timeout(7000)). Anything that can't be downloaded in
// that window renders as a broken image, so originals must stay small.
export const MAX_DIMENSION = 1600;
export const WEBP_QUALITY = 80;

/**
 * Re-encode an uploaded image to a web-sized WebP.
 *
 * Returns the original untouched when re-encoding would not actually help —
 * an already-small WebP would otherwise grow on a second pass.
 */
export async function optimizeImage(input, originalContentType) {
  const source = sharp(input, { animated: true }).rotate();
  const meta = await source.metadata();

  // `pages` > 1 means an animated GIF/WebP; its `height` covers every frame
  // stacked vertically, so derive the real frame height before comparing.
  const frameHeight = meta.pages > 1 ? meta.pageHeight : meta.height;
  const withinBounds = meta.width <= MAX_DIMENSION && frameHeight <= MAX_DIMENSION;

  const optimized = await source
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();

  if (withinBounds && optimized.byteLength >= input.byteLength) {
    return {
      buffer: Buffer.from(input),
      contentType: originalContentType,
      extension: extensionFor(originalContentType),
      optimized: false,
    };
  }

  return {
    buffer: optimized,
    contentType: "image/webp",
    extension: "webp",
    optimized: true,
  };
}

function extensionFor(contentType) {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    default:
      return "jpg";
  }
}
