import { createContext, useContext } from "react";
export const AccessVerifiedContext = createContext(true);
export const ACCESS_CHECK_EVENT = "paserve:access-verifying";
export function useAccessVerified() {
  return useContext(AccessVerifiedContext);
}
