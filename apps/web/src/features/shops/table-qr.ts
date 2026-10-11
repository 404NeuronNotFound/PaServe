import QRCode from "qrcode";
import { publicTablePath } from "@paserve/contracts";

export interface TableQr {
  url: string;
  svg: string;
  imageUrl: string;
}

/** Always encode the customer-facing web origin, never the API URL or internal IDs. */
export function tableCustomerUrl(
  shopSlug: string,
  code: string,
  origin: string,
): string {
  const base = new URL(origin);
  if (
    !["https:", "http:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash
  ) {
    throw new Error(
      "Use a valid public website origin, such as https://menu.example.com.",
    );
  }
  return new URL(publicTablePath(shopSlug, code), base.origin).href;
}

export async function generateTableQr(
  shopSlug: string,
  code: string,
  origin: string,
): Promise<TableQr> {
  const url = tableCustomerUrl(shopSlug, code, origin);
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

export function tableQrOrigin(): string {
  return import.meta.env.VITE_PUBLIC_APP_URL?.trim() || window.location.origin;
}
