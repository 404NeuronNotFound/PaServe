import type {
  WalkthroughCompletionRequest,
  WalkthroughProgressResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";
import { useSessionStore } from "../auth/stores/session";
function config() {
  const token = useSessionStore.getState().accessToken;
  if (!token) throw new Error("Your session is unavailable.");
  return {
    timeout: AUTH_REQUEST_TIMEOUT_MS,
    headers: { Authorization: "Bearer " + token, "X-PaServe-Client": "web" },
  };
}
export async function getWalkthroughProgress() {
  const { data } = await api.get<WalkthroughProgressResponse>(
    "/auth/walkthrough",
    config(),
  );
  return data;
}
export async function finishWalkthrough(input: WalkthroughCompletionRequest) {
  const { data } = await api.post<{ scope: string }>(
    "/auth/walkthrough",
    input,
    config(),
  );
  return data;
}
