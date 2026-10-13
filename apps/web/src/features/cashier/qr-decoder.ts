let decoder: Promise<(typeof import("jsqr"))["default"]> | undefined;
export function loadQrDecoder() {
  decoder ??= import("jsqr")
    .then((module) => module.default)
    .catch((error) => {
      decoder = undefined;
      throw error;
    });
  return decoder;
}
export async function readQrImage(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 10 * 1024 * 1024 ||
    !file.size
  )
    throw new Error("Choose a PNG, JPEG, or WebP image up to 10 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("The image could not be read.");
    const ratio = Math.min(
      1,
      1600 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new Error(
        "Image reading is unavailable in this browser. Paste the QR contents instead.",
      );
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = (await loadQrDecoder())(
      frame.data,
      frame.width,
      frame.height,
      { inversionAttempts: "attemptBoth" },
    );
    if (!result)
      throw new Error(
        "No QR code was found. Choose a clear image of the customer's order QR.",
      );
    return result.data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
