import { create } from "zustand";

interface SessionState {
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;
}

// Deliberately no persist middleware: tokens never go into local/sessionStorage.
export const useSessionStore = create<SessionState>((set) => ({
  accessToken: null,
  setAccessToken: (accessToken) => set({ accessToken }),
}));
