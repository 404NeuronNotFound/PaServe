const eventKey = "paserve.auth.signed-out";
const channelName = "paserve:auth-events";
type SignOutEvent = { type: "signed-out"; id: string };
let lastSentId: string | undefined;

function parse(value: unknown): SignOutEvent | null {
  try {
    const data: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (
      data &&
      typeof data === "object" &&
      "type" in data &&
      data.type === "signed-out" &&
      "id" in data &&
      typeof data.id === "string" &&
      data.id.length <= 100
    )
      return data as SignOutEvent;
  } catch {
    /* Ignore unrelated or malformed storage. */
  }
  return null;
}
function storedEvent() {
  try {
    return parse(localStorage.getItem(eventKey));
  } catch {
    return null;
  }
}

/** Only an invalidation notice is persisted or broadcast, never session credentials. */
export function announceSignOut() {
  if (typeof window === "undefined") return;
  const event: SignOutEvent = { type: "signed-out", id: crypto.randomUUID() };
  lastSentId = event.id;
  try {
    localStorage.setItem(eventKey, JSON.stringify(event));
  } catch {
    /* Broadcast still works without storage. */
  }
  try {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage(event);
    channel.close();
  } catch {
    /* Storage events provide the fallback. */
  }
}

export function listenForSignOut(onSignOut: () => void) {
  let seen = storedEvent()?.id;
  const receive = (event: SignOutEvent | null) => {
    if (!event || event.id === seen) return;
    seen = event.id;
    if (event.id === lastSentId) return;
    onSignOut();
  };
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(channelName);
    channel.onmessage = (event: MessageEvent<unknown>) =>
      receive(parse(event.data));
  } catch {
    /* Storage events provide the fallback. */
  }
  const storage = (event: StorageEvent) => {
    if (event.key === eventKey) receive(parse(event.newValue));
  };
  const resume = () => receive(storedEvent());
  window.addEventListener("storage", storage);
  window.addEventListener("focus", resume);
  window.addEventListener("pageshow", resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
    channel?.close();
    window.removeEventListener("storage", storage);
    window.removeEventListener("focus", resume);
    window.removeEventListener("pageshow", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}
