import { create } from "zustand";

export type FeedbackTone = "info" | "success" | "warning" | "error";
type ToastOptions = {
  duration?: 2000 | 3000 | 4000;
  tone?: "info" | "success";
};
export type FeedbackAction = {
  label: string;
  onClick: () => void | Promise<void>;
  errorMessage?: (error: unknown) => string;
};
type SnackbarOptions = { key?: string; duration?: number };
export type TransientNotice = {
  id: number;
  message: string;
  duration: number;
  tone: "info" | "success";
  key?: string;
} & (
  | { kind: "toast"; action?: never }
  | { kind: "snackbar"; action: FeedbackAction }
);
export type BannerNotice = {
  id: number;
  key: string;
  message: string;
  tone: "info" | "warning" | "error";
};

let nextId = 0;
function enqueue(current: TransientNotice[], notice: TransientNotice) {
  const queue = notice.key
    ? current.filter((item) => item.key !== notice.key)
    : current;
  // Keep the visible message and the most recent waiting updates; avoid a long backlog.
  return queue.length < 5
    ? [...queue, notice]
    : [queue[0], ...queue.slice(-3), notice];
}

// Feedback stays in memory. No messages, callbacks, or credentials are persisted.
export const useFeedbackStore = create<{
  notices: TransientNotice[];
  banners: BannerNotice[];
  toast: (message: string, options?: ToastOptions) => void;
  snackbar: (
    message: string,
    action: FeedbackAction,
    options?: SnackbarOptions,
  ) => void;
  banner: (key: string, message: string, tone?: BannerNotice["tone"]) => void;
  dismiss: (id: number) => void;
  dismissBanner: (key: string) => void;
  clearTransient: () => void;
  clear: () => void;
}>((set) => ({
  notices: [],
  banners: [],
  toast: (message, options) =>
    set((state) => ({
      notices: enqueue(state.notices, {
        id: ++nextId,
        kind: "toast",
        message,
        duration: options?.duration ?? 3000,
        tone: options?.tone ?? "success",
      }),
    })),
  snackbar: (message, action, options) =>
    set((state) => ({
      notices: enqueue(state.notices, {
        id: ++nextId,
        kind: "snackbar",
        message,
        action,
        key: options?.key,
        duration: Math.max(5000, Math.min(options?.duration ?? 8000, 30000)),
        tone: "info",
      }),
    })),
  banner: (key, message, tone = "warning") =>
    set((state) => ({
      banners: [
        ...state.banners.filter((item) => item.key !== key),
        { id: ++nextId, key, message, tone },
      ],
    })),
  dismiss: (id) =>
    set((state) => ({
      notices: state.notices.filter((item) => item.id !== id),
    })),
  dismissBanner: (key) =>
    set((state) => ({
      banners: state.banners.filter((item) => item.key !== key),
    })),
  clearTransient: () => set({ notices: [] }),
  clear: () => set({ notices: [], banners: [] }),
}));

export const feedback = {
  toast: (message: string, options?: ToastOptions) =>
    useFeedbackStore.getState().toast(message, options),
  snackbar: (
    message: string,
    action: FeedbackAction,
    options?: SnackbarOptions,
  ) => useFeedbackStore.getState().snackbar(message, action, options),
  banner: (key: string, message: string, tone?: BannerNotice["tone"]) =>
    useFeedbackStore.getState().banner(key, message, tone),
  dismissBanner: (key: string) =>
    useFeedbackStore.getState().dismissBanner(key),
  clearTransient: () => useFeedbackStore.getState().clearTransient(),
};
