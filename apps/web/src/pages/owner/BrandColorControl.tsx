import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { menuTheme } from "../../lib/menu-theme";
import {
  DEFAULT_MENU_PRIMARY_COLOR,
  DEFAULT_MENU_ACCENT_COLOR,
  isValidShopPrimaryColor,
  normalizeShopPrimaryColor,
} from "@paserve/contracts";
const palette = [
  ["Forest", "#243329"],
  ["Sage", "#C9EF83"],
  ["Espresso", "#54382A"],
  ["Terracotta", "#B9563E"],
  ["Ocean", "#246B80"],
  ["Plum", "#69436D"],
];
export function BrandColorControl({
  kind,
  value,
  disabled,
  onChange,
}: {
  kind: "primaryColor" | "accentColor";
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const primary = kind === "primaryColor";
  const label = primary ? "primary color" : "accent color";
  const color =
    value.trim() && isValidShopPrimaryColor(value)
      ? normalizeShopPrimaryColor(value)
      : primary
        ? DEFAULT_MENU_PRIMARY_COLOR
        : DEFAULT_MENU_ACCENT_COLOR;
  return (
    <div
      className="brand-color-control"
      style={menuTheme(
        primary ? color : undefined,
        primary ? undefined : color,
      )}
    >
      <div className="brand-color-display">
        <label className="brand-color-well">
          <Input
            type="color"
            aria-label={`Choose ${label}`}
            value={color}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
          <span aria-hidden="true" style={{ background: color }} />
        </label>
        <div>
          <strong>{color}</strong>
          <small>
            {primary ? "Your menu’s signature" : "A little extra personality"}
          </small>
        </div>
        <span
          className={`brand-color-sample ${primary ? "primary" : "accent"}`}
        >
          {primary ? "MENU" : "Featured"}
        </span>
      </div>
      <div
        className="brand-color-palette"
        role="group"
        aria-label={`${label} palette`}
      >
        {palette.map(([name, hex]) => (
          <Button variant="ghost" size="inherit"
            type="button"
            key={hex}
            disabled={disabled}
            aria-label={`Use ${name} for ${label}`}
            aria-pressed={color === hex}
            onClick={() => onChange(hex)}
          >
            <span style={{ background: hex }} aria-hidden="true" />
          </Button>
        ))}
        <Button variant="ghost" size="inherit"
          type="button"
          className="brand-color-reset"
          disabled={disabled}
          onClick={() => onChange("")}
          aria-label={`Reset ${label}`}
        >
          Default
        </Button>
      </div>
      <p className="field-hint">
        Text contrast adjusts automatically. Menu backgrounds, fonts, and spacing
        stay consistent. Fine-tune the hex value below.
      </p>
    </div>
  );
}
