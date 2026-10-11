import type {
  CreateTableRequest,
  CreateTableResponse,
  TablesResponse,
} from "@paserve/contracts";
import { api } from "../../../lib/api/client";
import "../../auth/api/session";

export const tablesKey = (userId: string, shopId: string) =>
  ["tables", userId, shopId] as const;
export async function listTables(
  shopId: string,
  signal?: AbortSignal,
): Promise<TablesResponse> {
  return (
    await api.get<TablesResponse>(
      `/shops/${encodeURIComponent(shopId)}/tables`,
      { signal },
    )
  ).data;
}
export async function createTable(
  shopId: string,
  input: CreateTableRequest,
): Promise<CreateTableResponse> {
  return (
    await api.post<CreateTableResponse>(
      `/shops/${encodeURIComponent(shopId)}/tables`,
      input,
    )
  ).data;
}
