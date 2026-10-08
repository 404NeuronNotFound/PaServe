import type { RegisterRequest, RegisterResponse } from "@paserve/contracts";
import { api } from "../../../lib/api/client";

export async function registerAccount(
  input: RegisterRequest,
): Promise<RegisterResponse> {
  const { data } = await api.post<RegisterResponse>("/auth/register", input);
  return data;
}
