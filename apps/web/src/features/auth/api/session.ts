import type {
  CurrentUserResponse,
  LoginRequest,
  LoginResponse,
} from "@paserve/contracts";
import axios, { type InternalAxiosRequestConfig } from "axios";
import { api } from "../../../lib/api/client";
import { useSessionStore } from "../stores/session";

const cookieHeaders = { "X-PaServe-Client": "web" };
export const currentUserKey = ["auth", "me"] as const;
let refreshPromise: Promise<LoginResponse> | null = null;

export async function loginAccount(
  input: LoginRequest,
): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>("/auth/login", input, {
    headers: cookieHeaders,
  });
  useSessionStore.getState().setAccessToken(data.accessToken);
  return data;
}

export function refreshSession(): Promise<LoginResponse> {
  if (!refreshPromise) {
    refreshPromise = api
      .post<LoginResponse>("/auth/refresh", {}, { headers: cookieHeaders })
      .then(({ data }) => {
        useSessionStore.getState().setAccessToken(data.accessToken);
        return data;
      })
      .catch((error: unknown) => {
        useSessionStore.getState().setAccessToken(null);
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.request.use((config) => {
  const token = useSessionStore.getState().accessToken;
  if (token && !config.url?.startsWith("/auth/"))
    config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      error.config
    ) {
      const config = error.config as InternalAxiosRequestConfig & {
        authRetried?: boolean;
      };
      if (
        config.headers.Authorization &&
        !config.authRetried &&
        !["/auth/login", "/auth/refresh", "/auth/logout"].includes(
          config.url ?? "",
        )
      ) {
        config.authRetried = true;
        const session = await refreshSession();
        config.headers.Authorization = `Bearer ${session.accessToken}`;
        return api.request(config);
      }
    }
    throw error;
  },
);

export async function getCurrentUser(): Promise<CurrentUserResponse> {
  if (!useSessionStore.getState().accessToken) await refreshSession();
  const { data } = await api.get<CurrentUserResponse>("/auth/me", {
    headers: {
      Authorization: `Bearer ${useSessionStore.getState().accessToken}`,
    },
  });
  return data;
}

export async function logoutAccount(): Promise<void> {
  await api.post("/auth/logout", {}, { headers: cookieHeaders });
  useSessionStore.getState().setAccessToken(null);
}
