import type { RegisterRequest, RegisterResponse } from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../../lib/api/client";

export async function registerAccount(
  input: RegisterRequest,
): Promise<RegisterResponse> {
  const { data } = await api.post<RegisterResponse>("/auth/register", input, {
    timeout: AUTH_REQUEST_TIMEOUT_MS,
  });
  return data;
}
