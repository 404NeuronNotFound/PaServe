import { WALKTHROUGH_VERSION } from "@paserve/contracts";
const closed = new Set<string>();
const key = (userId: string, scope: string) =>
  "paserve:keybeen:" + WALKTHROUGH_VERSION + ":" + userId + ":" + scope;
export function dismissedHere(userId: string, scope: string) {
  const id = key(userId, scope);
  try {
    return closed.has(id) || localStorage.getItem(id) === "done";
  } catch {
    return closed.has(id);
  }
}
export function dismissHere(userId: string, scope: string) {
  const id = key(userId, scope);
  if (closed.size >= 1000) closed.clear();
  closed.add(id);
  try {
    localStorage.setItem(id, "done");
  } catch {
    /* Memory fallback for this visit. */
  }
}
