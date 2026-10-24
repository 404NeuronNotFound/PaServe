import { create } from "zustand";

interface SessionState {
  accessToken: string | null;
  version: number;
  signedOutElsewhere: boolean;
  setAccessToken: (token: string | null) => void;
  endSession: (remote?: boolean) => void;
}

// Deliberately no persist middleware: tokens never go into local/sessionStorage.
export const useSessionStore = create<SessionState>((set) => ({
  accessToken: null,
  version: 0,
  signedOutElsewhere: false,
  setAccessToken: (accessToken) => set({ accessToken }),
  endSession: (remote = false) =>
    set((state) => ({
      accessToken: null,
      version: state.version + 1,
      signedOutElsewhere: remote,
    })),
}));
