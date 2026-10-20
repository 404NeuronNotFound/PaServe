import { createContext, useContext } from "react";

export const FieldContext = createContext<{
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
} | null>(null);

export function useFieldControl(id?: string, describedBy?: string) {
  const field = useContext(FieldContext);
  if (!field || id !== field.id) return {};
  return {
    id: field.id,
    required: field.required || undefined,
    "aria-invalid": field.invalid || undefined,
    "aria-describedby": [...new Set(
      [field.describedBy, describedBy].filter(Boolean).join(" ").split(/\s+/).filter(Boolean),
    )].join(" ") || undefined,
  };
}
