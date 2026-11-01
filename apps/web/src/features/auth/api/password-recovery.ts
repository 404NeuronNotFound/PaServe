import type {
  ResetPasswordRequest,
  PasswordRecoveryResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../../lib/api/client";

const options = {
  headers: { "X-PaServe-Client": "web" },
  timeout: AUTH_REQUEST_TIMEOUT_MS,
};
export async function requestPasswordRecovery(
  email: string,
  challengeToken?: string,
) {
  const { data } = await api.post<PasswordRecoveryResponse>(
    "/auth/forgot-password",
    { email, ...(challengeToken ? { challengeToken } : {}) },
    options,
  );
  return data;
}
export async function resetRecoveredPassword(input: ResetPasswordRequest) {
  const { data } = await api.post<PasswordRecoveryResponse>(
    "/auth/reset-password",
    input,
    options,
  );
  return data;
}
