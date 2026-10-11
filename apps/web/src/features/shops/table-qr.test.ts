// @vitest-environment node
import { expect, it } from "vitest";
import sharp from "sharp";
import jsQR from "jsqr";
import { generateTableQr, tableCustomerUrl } from "./table-qr";

const code = "t_9dd21e8326b440b2a73f22d4f16c038a";
it.each([code, "T12", "T-75992537-5d60-4d22-8e1e-60a114644681"])(
  "decodes the exported SVG to the exact absolute customer URL for %s",
  async (code) => {
    const qr = await generateTableQr(
      "my-cafe",
      code,
      "https://menu.example.com",
    );
    const { data, info } = await sharp(Buffer.from(qr.svg))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    expect(decoded?.data).toBe(
      `https://menu.example.com/my-cafe/table/${code}`,
    );
    expect(qr.url).toBe(decoded?.data);
    expect(decodeURIComponent(qr.imageUrl.split(",")[1])).toBe(qr.svg);
    expect(qr.svg).toContain('viewBox="0 0');
  },
);
it("preserves a four-module white quiet zone in the actual exported image", async () => {
  const qr = await generateTableQr("cafe", code, "https://menu.example.com");
  const { data, info } = await sharp(Buffer.from(qr.svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const modules = Number(qr.svg.match(/viewBox="0 0 (\d+) /)?.[1]);
  expect(modules).toBeGreaterThan(8);
  const border = Math.floor((info.width / modules) * 4);
  let whiteBorder = true;
  for (let y = 0; y < info.height; y++) {
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
        whiteBorder = false;
    }
  }
  expect(whiteBorder).toBe(true);
  expect(qr.svg).not.toContain("script");
});
it("uses the saved token instead of table/shop/user IDs", () => {
  expect(tableCustomerUrl("cafe", code, "https://menu.example.com/")).toBe(
    `https://menu.example.com/cafe/table/${code}`,
  );
});
it.each([
  "javascript:alert(1)",
  "ftp://menu.example.com",
  "https://user:password@menu.example.com",
  "https://menu.example.com/private",
  "https://menu.example.com?token=secret",
  "https://menu.example.com#token",
  "",
  "not a url",
])("rejects invalid or credential-bearing origins (%s)", (origin) => {
  expect(() => tableCustomerUrl("cafe", code, origin)).toThrow();
});
it.each(["75992537-5d60-4d22-8e1e-60a114644681", "../private", "T12?secret=1"])(
  "rejects IDs and unsafe code inputs before generation (%s)",
  async (code) => {
    await expect(
      generateTableQr("cafe", code, "https://menu.example.com"),
    ).rejects.toThrow();
  },
);
it("uses each requested shop and saved code independently", async () => {
  const a = await generateTableQr("cafe-a", code, "https://menu.example.com");
  const b = await generateTableQr("cafe-b", "T12", "https://menu.example.com");
  expect(a.url).toContain("/cafe-a/table/");
  expect(b.url).toContain("/cafe-b/table/T12");
  expect(a.svg).not.toBe(b.svg);
});
