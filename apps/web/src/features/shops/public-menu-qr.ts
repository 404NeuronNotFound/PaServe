import { customerWebsiteOrigin } from "./table-qr";
import type { TableQr } from "./table-qr";

export function pickupMenuUrl(slug: string, origin: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$(?![\s\S])/.test(slug) || slug.length > 100)
    throw new Error("A saved public shop slug is required.");
  return new URL(
    `/menu/${encodeURIComponent(slug)}?service=pickup`,
    customerWebsiteOrigin(origin),
  ).href;
}

export function isLoopbackMenuUrl(url: string) {
  const host = new URL(url).hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127\./.test(host) ||
    host === "[::1]" ||
    host === "0.0.0.0"
  );
}

export async function generatePublicMenuQr(
  slug: string,
  origin: string,
): Promise<TableQr> {
  const url = pickupMenuUrl(slug, origin);
  const { default: QRCode } = await import("qrcode");
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 4,
    width: 1024,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
  return {
    url,
    svg,
    imageUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  };
}
