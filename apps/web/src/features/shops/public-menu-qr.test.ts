// @vitest-environment node
import { expect, it } from "vitest";
import sharp from "sharp";
import jsQR from "jsqr";
import {
  generatePublicMenuQr,
  pickupMenuUrl,
  isLoopbackMenuUrl,
} from "./public-menu-qr";

it.each(["cafe-a", "menu", "connection", "x".repeat(100)])(
  "decodes a printed-size QR to the exact public pickup menu for %s",
  async (slug) => {
    const qr = await generatePublicMenuQr(slug, "https://paserve.example");
    // Approximately 30 mm at 300 DPI, matching the business card's QR.
    const { data, info } = await sharp(Buffer.from(qr.svg))
      .resize(354, 354)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(
      jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data,
    ).toBe(`https://paserve.example/menu/${slug}?service=pickup`);
    expect(qr.url).not.toMatch(/table|token|userId|shopId/);
    expect(decodeURIComponent(qr.imageUrl.split(",")[1])).toBe(qr.svg);
  },
);

it("keeps four white modules around every side of the QR", async () => {
  const qr = await generatePublicMenuQr("cafe", "https://paserve.example");
  const { data, info } = await sharp(Buffer.from(qr.svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const modules = Number(qr.svg.match(/viewBox="0 0 (\d+) /)?.[1]);
  const border = Math.floor((info.width / modules) * 4);
  expect(border).toBeGreaterThan(0);
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (
        x >= border &&
        x < info.width - border &&
        y >= border &&
        y < info.height - border
      )
        continue;
      const offset = (y * info.width + x) * 4;
      if (data.subarray(offset, offset + 4).some((value) => value !== 255))
        throw new Error("QR quiet zone was altered.");
    }
});
it.each([
  "javascript:alert(1)",
  "https://user:secret@site.test",
  "https://site.test/path",
  "https://site.test?secret=x",
  "https://site.test#x",
  "ftp://site.test",
])("rejects an unsafe public origin %s", (origin) => {
  expect(() => pickupMenuUrl("cafe", origin)).toThrow();
});
it.each(["../private", "CAFE", "cafe?table=1", "", "cafe\n", "x".repeat(101)])(
  "rejects malformed shop identity %s",
  (slug) => {
    expect(() => pickupMenuUrl(slug, "https://site.test")).toThrow();
  },
);
it.each([
  "http://localhost:5173",
  "http://127.0.0.1",
  "http://127.3.4.5",
  "http://[::1]",
  "http://foo.localhost",
])("identifies QR links that cannot be printed for customers: %s", (origin) => {
  expect(isLoopbackMenuUrl(pickupMenuUrl("cafe", origin))).toBe(true);
});
