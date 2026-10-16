const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/i;
export type OrderQrReference = {
  shopId: string;
  orderId: string;
  qrToken: string;
};

/** Parse references only. The server must verify signature, membership and state. */
export function parseOrderQrToken(
  raw: string,
  purpose: "order-receipt" | "order-tracking" = "order-receipt",
): (OrderQrReference & { expiresAt: number }) | null {
  const qrToken = raw.trim();
  if (
    qrToken.length > 1024 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$(?![\s\S])/.test(qrToken)
  )
    return null;
  try {
    const encoded = qrToken
      .split(".")[0]
      .replaceAll("-", "+")
      .replaceAll("_", "/");
    const bytes = Uint8Array.from(
      atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
      (char) => char.charCodeAt(0),
    );
    const claims = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    if (
      !claims ||
      claims.v !== 1 ||
      claims.purpose !== purpose ||
      typeof claims.shopId !== "string" ||
      !uuid.test(claims.shopId) ||
      typeof claims.orderId !== "string" ||
      !uuid.test(claims.orderId) ||
      typeof claims.nonce !== "string" ||
      !uuid.test(claims.nonce) ||
      typeof claims.exp !== "number" ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp <= 0
    )
      return null;
    return {
      shopId: claims.shopId,
      orderId: claims.orderId,
      qrToken,
      expiresAt: claims.exp,
    };
  } catch {
    return null;
  }
}
export function parseOrderQr(raw: string): OrderQrReference | null {
  const token = parseOrderQrToken(raw);
  return token
    ? { shopId: token.shopId, orderId: token.orderId, qrToken: token.qrToken }
    : null;
}
