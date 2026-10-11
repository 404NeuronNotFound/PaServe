import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  hasShopPermission,
  type ApiErrorResponse,
  type CurrentUserResponse,
} from "@paserve/contracts";
import { useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { feedback } from "../../app/stores/feedback";

export function useCustomizationAccess() {
  const membership = useActiveShop();
  const client = useQueryClient();
  const userId =
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ?? "";
  const allowed =
    Boolean(userId) && hasShopPermission(membership.role, "shop.menu.manage");
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [error, setError] = useState("");
  const running = useRef(false),
    active = useRef(false);
  const identity = `${userId}:${membership.shopId}`;
  const current = useRef({ identity, allowed });
  useEffect(() => {
    current.current = { identity, allowed };
  }, [identity, allowed]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  function stillHere() {
    return (
      active.current &&
      current.current.identity === identity &&
      current.current.allowed &&
      client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ===
        userId
    );
  }
  async function run(
    operation: () => Promise<unknown>,
    success: string,
    onSaved?: () => void,
  ) {
    if (!stillHere() || running.current || blocked) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
      if (!stillHere()) return;
      await client.invalidateQueries({
        queryKey: ["customization", userId, membership.shopId],
      });
      void client.invalidateQueries({
        queryKey: ["public-menu", membership.shop.slug],
      });
      void client.invalidateQueries({
        queryKey: ["public-product", membership.shop.slug],
      });
      if (!stillHere()) return;
      feedback.toast(success);
      onSaved?.();
    } catch (failure) {
      if (!stillHere()) return;
      const status = isAxiosError<ApiErrorResponse>(failure)
        ? failure.response?.status
        : undefined;
      if (status === 400 || status === 409) {
        setError(
          isAxiosError<ApiErrorResponse>(failure)
            ? (failure.response?.data?.message ??
                "Check your choices and try again.")
            : "Check your choices.",
        );
      } else {
        setBlocked(true);
        setError(
          [401, 403, 404].includes(status ?? 0)
            ? "The product or your access changed. Refresh before continuing."
            : "We couldn't confirm the save. Refresh before trying again.",
        );
      }
    } finally {
      running.current = false;
      if (stillHere()) setBusy(false);
    }
  }
  return {
    membership,
    userId,
    allowed,
    busy,
    blocked,
    error,
    run,
    clearError: () => setError(""),
    recovered: () => {
      setBlocked(false);
      setError("");
    },
  };
}
