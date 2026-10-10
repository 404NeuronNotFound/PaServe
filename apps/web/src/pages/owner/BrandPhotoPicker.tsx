import { useState } from "react";
import { ProductPhotoPicker } from "./ProductPhotoPicker";
import { BrandImageCropper } from "./BrandImageCropper";
import type { ReactNode } from "react";
import "./products.css";
import "./shop-settings.css";

export function BrandPhotoPicker({
  kind,
  onChange,
  onCropping,
  children,
  ...props
}: {
  kind: "logo" | "banner";
  onChange: (file: File | null, error: string) => void;
  onCropping: (value: boolean) => void;
  children: ReactNode;
} & Omit<
  Parameters<typeof ProductPhotoPicker>[0],
  "kind" | "onChange" | "children"
>) {
  const [source, setSource] = useState<File | null>(null);
  function close() {
    setSource(null);
    onCropping(false);
  }
  return (
    <>
      <ProductPhotoPicker
        {...props}
        kind={kind}
        onChange={(file, error) => {
          if (file && !error) {
            setSource(file);
            onCropping(true);
          } else onChange(file, error);
        }}
      >
        {children}
      </ProductPhotoPicker>
      {source && (
        <BrandImageCropper
          file={source}
          kind={kind}
          onClose={close}
          onApply={(cropped) => {
            onChange(cropped, "");
            close();
          }}
        />
      )}
    </>
  );
}
