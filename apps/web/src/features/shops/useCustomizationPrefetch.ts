import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CurrentUserResponse } from "@paserve/contracts";
import { currentUserKey } from "../auth/api/session";
import { customizationQuery } from "./catalog-queries";

/** One intentional next-screen read group; never prefetch an entire catalog. */
export function useCustomizationPrefetch(
  userId: string,
  shopId: string,
  enabled: boolean,
) {
  const client = useQueryClient();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => cancel, [cancel, userId, shopId, enabled]);
  const schedule = useCallback(
    (productId: string) => {
      cancel();
      const network = (
        navigator as Navigator & {
          connection?: { saveData?: boolean; effectiveType?: string };
        }
      ).connection;
      if (
        !enabled ||
        network?.saveData ||
        ["slow-2g", "2g"].includes(network?.effectiveType ?? "")
      )
        return;
      timer.current = setTimeout(() => {
        if (
          client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id !==
          userId
        )
          return;
        if (client.isFetching({ queryKey: ["customization"] })) return;
        void client.prefetchQuery(
          customizationQuery(userId, shopId, productId),
        );
      }, 150);
    },
    [cancel, client, enabled, shopId, userId],
  );
  return { schedule, cancel };
}
