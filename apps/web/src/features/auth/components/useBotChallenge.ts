import { useCallback, useState } from "react";
import { isAxiosError } from "axios";
import type { ApiErrorResponse } from "@paserve/contracts";

export function useBotChallenge() {
  const [required, setRequired] = useState(false);
  const [token, setToken] = useState("");
  const [version, setVersion] = useState(0);
  const onToken = useCallback((value: string) => setToken(value), []);
  function handleError(error: unknown): string | undefined {
    if (!isAxiosError<ApiErrorResponse>(error)) return;
    const code = error.response?.data?.code;
    if (code !== "BOT_CHALLENGE_REQUIRED" && code !== "BOT_CHALLENGE_UNAVAILABLE") return;
    setRequired(true);
    return code === "BOT_CHALLENGE_UNAVAILABLE"
      ? "The security check is temporarily unavailable. Please try again shortly."
      : "Please complete the security check, then try again.";
  }
  function resetToken() {
    setToken("");
    setVersion((value) => value + 1);
  }
  return { required, token, version, onToken, handleError, resetToken };
}
