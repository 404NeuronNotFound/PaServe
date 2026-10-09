import { useEffect } from "react";
import { feedback } from "../../app/stores/feedback";

export function ConnectionFeedback() {
  useEffect(() => {
    let offline = !navigator.onLine;
    const warn = () => {
      offline = true;
      feedback.banner(
        "connection-offline",
        "You’re offline. Reconnect before saving changes.",
        "warning",
      );
    };
    const recover = () => {
      feedback.dismissBanner("connection-offline");
      if (offline) feedback.toast("You’re back online.");
      offline = false;
    };
    if (offline) warn();
    window.addEventListener("offline", warn);
    window.addEventListener("online", recover);
    return () => {
      window.removeEventListener("offline", warn);
      window.removeEventListener("online", recover);
      feedback.dismissBanner("connection-offline");
    };
  }, []);
  return null;
}
