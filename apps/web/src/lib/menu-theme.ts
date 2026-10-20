import type { CSSProperties } from "react";
import {
  DEFAULT_MENU_PRIMARY_COLOR,
  DEFAULT_MENU_ACCENT_COLOR,
  isValidShopPrimaryColor,
  normalizeShopPrimaryColor,
} from "@paserve/contracts";

const validColor = (value: string | null | undefined, fallback: string) =>
  typeof value === "string" && isValidShopPrimaryColor(value)
    ? normalizeShopPrimaryColor(value) || fallback
    : fallback;

function foreground(color: string): string {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
    ? "#000000"
    : "#FFFFFF";
}

/** Variables are scoped to the current customer menu, never the owner shell. */
export function menuTheme(
  primaryColor?: string | null,
  accentColor?: string | null,
): CSSProperties {
  const primary = validColor(primaryColor, DEFAULT_MENU_PRIMARY_COLOR);
  const accent = validColor(accentColor, DEFAULT_MENU_ACCENT_COLOR);
  return {
    "--menu-primary": primary,
    "--menu-on-primary": foreground(primary),
    "--menu-accent": accent,
    "--menu-on-accent": foreground(accent),
  } as CSSProperties;
}
