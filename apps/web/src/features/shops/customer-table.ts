import { create } from "zustand";
import { publicTablePath, type PublicTableContext } from "@paserve/contracts";

export const CUSTOMER_TABLE_STORAGE_KEY = "paserve-customer-tables:v1";
type TableStorage = Pick<Storage, "getItem" | "setItem">;
export interface CustomerTableState {
  codes: Record<string, string>;
  resolved: Record<string, PublicTableContext>;
  beginResolution: (shopSlug: string, code: string) => void;
  setResolved: (table: PublicTableContext) => void;
  clear: (shopSlug: string) => void;
}
function browserStorage(): TableStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
export function createCustomerTableStore(
  storage: TableStorage | null = browserStorage(),
) {
  const codes: Record<string, string> = {};
  try {
    const saved: unknown = JSON.parse(
      storage?.getItem(CUSTOMER_TABLE_STORAGE_KEY) ?? "null",
    );
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      for (const [slug, code] of Object.entries(saved).slice(0, 100)) {
        if (typeof code !== "string") continue;
        try {
          publicTablePath(slug, code);
          codes[slug] = code;
        } catch {
          /* Ignore invalid hints. */
        }
      }
    }
  } catch {
    /* Blocked/corrupt storage must not prevent scanning. */
  }
  const store = create<CustomerTableState>((set) => ({
    codes,
    // Stored codes are navigation hints. Refresh requires live server resolution.
    resolved: {},
    beginResolution: (slug, code) => {
      publicTablePath(slug, code);
      set((state) => {
        const resolved = { ...state.resolved };
        delete resolved[slug];
        return { codes: { ...state.codes, [slug]: code }, resolved };
      });
    },
    setResolved: (table) => {
      publicTablePath(table.shopSlug, table.code);
      set((state) => ({
        codes: { ...state.codes, [table.shopSlug]: table.code },
        resolved: { ...state.resolved, [table.shopSlug]: table },
      }));
    },
    clear: (slug) =>
      set((state) => {
        const codes = { ...state.codes },
          resolved = { ...state.resolved };
        delete codes[slug];
        delete resolved[slug];
        return { codes, resolved };
      }),
  }));
  store.subscribe((state, previous) => {
    if (state.codes === previous.codes) return;
    try {
      storage?.setItem(CUSTOMER_TABLE_STORAGE_KEY, JSON.stringify(state.codes));
    } catch {
      /* Context remains usable in memory if storage is unavailable. */
    }
  });
  return store;
}
export const useCustomerTables = createCustomerTableStore();
