import { useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import "./media.css";

type Props = Omit<ComponentProps<"img">, "src" | "alt" | "onError" | "width" | "height"> & {
  src?: string | null;
  alt: string;
  width: number;
  height: number;
  fit?: "cover" | "contain";
  fallback: ReactNode;
};

/** The surrounding frame owns layout; failures retain its reserved geometry. */
export function MediaImage({ src, fallback, ...props }: Props) {
  return src ? <ImageResource key={src} src={src} fallback={fallback} {...props} /> : fallback;
}

function ImageResource({ src, fallback, className, fit = "cover", loading = "lazy",
  fetchPriority = loading === "eager" ? "auto" : "low", ...props }: Props & { src: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? fallback : <img {...props} src={src}
    className={cn("paserve-media-image", className)} data-fit={fit}
    loading={loading} decoding="async" fetchPriority={fetchPriority}
    referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
