import type {
  CurrentUserResponse,
  LoginRequest,
  LoginResponse,
  UpdateProfileRequest,
  UpdateProfileResponse,
  ChangeEmailRequest,
  ChangePasswordRequest,
} from "@paserve/contracts";
import axios, { type InternalAxiosRequestConfig } from "axios";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../../lib/api/client";
import { useSessionStore } from "../stores/session";
import { withSessionLock } from "./session-lock";

const cookieHeaders = { "X-PaServe-Client": "web" };
const cookieRequest = {
  headers: cookieHeaders,
  timeout: AUTH_REQUEST_TIMEOUT_MS,
};
export const currentUserKey = ["auth", "me"] as const;
let refreshPromise: Promise<LoginResponse> | null = null;
let logoutPromise: Promise<void> | null = null;

export async function loginAccount(
  input: LoginRequest,
): Promise<LoginResponse> {
  const { data } = await withSessionLock(() =>
    api.post<LoginResponse>("/auth/login", input, cookieRequest),
  );
  useSessionStore.getState().setAccessToken(data.accessToken);
  return data;
}

export function refreshSession(): Promise<LoginResponse> {
  if (logoutPromise) {
    return Promise.reject(new Error("Sign-out is in progress."));
  }
  if (!refreshPromise) {
    refreshPromise = withSessionLock(() =>
      api.post<LoginResponse>("/auth/refresh", {}, cookieRequest),
    )
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
    timeout: AUTH_REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${useSessionStore.getState().accessToken}`,
    },
  });
  return data;
}

export function logoutAccount(): Promise<void> {
  if (!logoutPromise) {
    logoutPromise = (async () => {
      // Finish rotation before logout so the server revokes the current cookie.
      if (refreshPromise) await refreshPromise.catch(() => undefined);
      await withSessionLock(() => api.post("/auth/logout", {}, cookieRequest));
      useSessionStore.getState().setAccessToken(null);
    })().finally(() => {
      logoutPromise = null;
    });
  }
  return logoutPromise;
}

async function accountRequest() {
  if (logoutPromise) throw new Error("Sign-out is in progress.");
  if (refreshPromise) await refreshPromise;
  if (!useSessionStore.getState().accessToken) await refreshSession();
  return {
    ...cookieRequest,
    headers: {
      ...cookieHeaders,
      Authorization: `Bearer ${useSessionStore.getState().accessToken}`,
    },
  };
}

export async function updateProfile(input: UpdateProfileRequest) {
  const { data } = await api.patch<UpdateProfileResponse>(
    "/auth/profile",
    input,
    await accountRequest(),
  );
  return data;
}

export async function changeEmail(input: ChangeEmailRequest) {
  await api.post("/auth/email", input, await accountRequest());
  useSessionStore.getState().setAccessToken(null);
}

export async function changePassword(input: ChangePasswordRequest) {
  await api.post("/auth/password", input, await accountRequest());
  useSessionStore.getState().setAccessToken(null);
}
