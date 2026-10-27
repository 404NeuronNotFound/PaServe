import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { InlineMessage } from "../../../components/feedback/InlineMessage";
import "./bot-challenge.css";

type Turnstile = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    action: "login" | "register";
    size: "flexible";
    theme: "auto";
    "response-field": false;
    "refresh-expired": "manual";
    retry: "never";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => boolean;
  }) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window { turnstile?: Turnstile }
}
let loading: Promise<Turnstile> | undefined;

function loadWidget(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error("Security check could not load"));
    };
    const timer = window.setTimeout(fail, 12_000);
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else fail();
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

export function BotChallenge({ action, onToken }: {
  action: "login" | "register";
  onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  useEffect(() => {
    if (!sitekey) return;
    let disposed = false;
    let widget: string | undefined;
    let api: Turnstile | undefined;
    void loadWidget().then((loaded) => {
      if (disposed || !container.current) return;
      api = loaded;
      widget = loaded.render(container.current, {
        sitekey, action, size: "flexible", theme: "auto", "response-field": false,
        "refresh-expired": "manual", retry: "never",
        callback: (token) => { if (!disposed) { setMessage(""); onToken(token); } },
        "expired-callback": () => { if (!disposed) { onToken(""); setMessage("Security check expired. Please try it again."); } },
        "error-callback": () => { if (!disposed) { onToken(""); setMessage("Security check could not complete. Check your connection and try again."); } return true; },
      });
      setReady(true);
    }).catch(() => {
      if (!disposed) { onToken(""); setMessage("Security check could not load. Check your connection and try again."); }
    });
    return () => {
      disposed = true;
      if (widget !== undefined) api?.remove(widget);
    };
  }, [action, onToken, sitekey, attempt]);
  return <div className="bot-challenge" role="group" aria-label="Security check">
    <p>Complete this security check to continue.</p>
    <div ref={container} />
    {!sitekey ? <InlineMessage>Security check is unavailable. Please try again later.</InlineMessage> : message ? <>
      <InlineMessage>{message}</InlineMessage>
      <Button type="button" variant="outline" onClick={() => { onToken(""); setMessage(""); setReady(false); setAttempt((value) => value + 1); }}>Retry security check</Button>
    </> : !ready ? <p role="status">Loading security check…</p> : null}
  </div>;
}
