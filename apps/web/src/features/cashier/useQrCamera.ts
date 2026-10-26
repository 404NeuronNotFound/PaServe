import { useCallback, useEffect, useRef, useState } from "react";
import { loadQrDecoder } from "./qr-decoder";
import { ACCESS_CHECK_EVENT, useAccessVerified } from "../auth/access-status";

export function cameraUnavailableReason() {
  if (window.isSecureContext === false)
    return "Camera access requires a secure connection. Open PaServe over HTTPS, or use an image or pasted QR contents below.";
  if (!navigator.mediaDevices?.getUserMedia)
    return "This browser does not support camera scanning. Use an image or pasted QR contents below.";
  return "";
}
export function cameraFailure(error: unknown): string {
  const name =
    error instanceof Error || error instanceof DOMException ? error.name : "";
  if (["NotAllowedError", "SecurityError"].includes(name))
    return "Camera access was denied. Allow camera access in your browser or device settings, then try again. You can also use the options below.";
  if (["NotFoundError", "DevicesNotFoundError"].includes(name))
    return "No camera was found. Connect a camera, or use the options below.";
  if (["NotReadableError", "TrackStartError"].includes(name))
    return "The camera is busy or unavailable. Close other apps using it and try again, or use the options below.";
  if (name === "OverconstrainedError")
    return "The selected camera is unavailable. Try the default camera, or use the options below.";
  return "Unable to start camera scanning. Try again, or use an image or pasted QR contents below.";
}
export function useQrCamera(onCode: (raw: string) => boolean) {
  const verified = useAccessVerified();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const callback = useRef(onCode);
  const [phase, setPhase] = useState<"idle" | "starting" | "scanning">("idle");
  const [error, setError] = useState("");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  useEffect(() => {
    callback.current = onCode;
  }, [onCode]);
  const release = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);
  const stop = useCallback(() => {
    generation.current++;
    release();
    if (mounted.current) setPhase("idle");
  }, [release]);
  useEffect(() => {
    mounted.current = true;
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", stop);
    window.addEventListener(ACCESS_CHECK_EVENT, stop);
    return () => {
      mounted.current = false;
      stop();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener(ACCESS_CHECK_EVENT, stop);
    };
  }, [stop]);
  const start = useCallback(
    async (selected = "") => {
      if (!verified) return;
      const reason = cameraUnavailableReason();
      if (reason) {
        setError(reason);
        return;
      }
      stop();
      const ticket = ++generation.current;
      setError("");
      setPhase("starting");
      let acquired: MediaStream | undefined;
      const current = () => mounted.current && generation.current === ticket;
      try {
        const decode = await loadQrDecoder();
        if (!current()) return;
        try {
          acquired = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: selected
              ? { deviceId: { exact: selected } }
              : {
                  facingMode: { ideal: "environment" },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                },
          });
        } catch (failure) {
          if (!current()) return;
          if (
            !selected &&
            failure instanceof DOMException &&
            failure.name === "OverconstrainedError"
          )
            acquired = await navigator.mediaDevices.getUserMedia({
              audio: false,
              video: true,
            });
          else throw failure;
        }
        if (!current()) {
          acquired.getTracks().forEach((track) => track.stop());
          return;
        }
        const node = video.current;
        if (!node) {
          acquired.getTracks().forEach((track) => track.stop());
          setPhase("idle");
          setError(
            "The camera preview is unavailable. Try again, or use the options below.",
          );
          return;
        }
        stream.current = acquired;
        node.srcObject = acquired;
        await node.play();
        if (!current()) return;
        const tracks = acquired.getVideoTracks();
        if (
          !tracks.length ||
          tracks.every((track) => track.readyState === "ended")
        )
          throw new DOMException(
            "Camera disconnected before playback",
            "NotReadableError",
          );
        if (document.hidden) {
          stop();
          return;
        }
        setDeviceId(
          acquired.getVideoTracks()[0]?.getSettings().deviceId ?? selected,
        );
        setPhase("scanning");
        for (const track of acquired.getVideoTracks())
          track.addEventListener(
            "ended",
            () => {
              if (current()) {
                stop();
                setError(
                  "The camera disconnected. Try again, or use the options below.",
                );
              }
            },
            { once: true },
          );
        if (navigator.mediaDevices.enumerateDevices)
          void navigator.mediaDevices
            .enumerateDevices()
            .then((devices) => {
              if (current())
                setCameras(
                  devices.filter((device) => device.kind === "videoinput"),
                );
            })
            .catch(() => undefined);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas unavailable");
        function scan() {
          if (!current()) return;
          try {
            if (
              node!.readyState >= 2 &&
              node!.videoWidth &&
              node!.videoHeight
            ) {
              const ratio = Math.min(
                1,
                1280 / Math.max(node!.videoWidth, node!.videoHeight),
              );
              canvas.width = Math.max(1, Math.round(node!.videoWidth * ratio));
              canvas.height = Math.max(
                1,
                Math.round(node!.videoHeight * ratio),
              );
              context!.drawImage(node!, 0, 0, canvas.width, canvas.height);
              const frame = context!.getImageData(
                0,
                0,
                canvas.width,
                canvas.height,
              );
              const result = decode(frame.data, frame.width, frame.height, {
                inversionAttempts: "attemptBoth",
              });
              if (result && callback.current(result.data)) {
                stop();
                return;
              }
            }
            if (current()) timer.current = setTimeout(scan, 250);
          } catch {
            if (current()) {
              stop();
              setError(
                "Camera reading failed. Try again, or use the options below.",
              );
            }
          }
        }
        timer.current = setTimeout(scan, 250);
      } catch (failure) {
        if (current()) {
          release();
          setPhase("idle");
          setError(cameraFailure(failure));
        }
      }
    },
    [release, stop, verified],
  );
  return { videoRef: video, phase, error, cameras, deviceId, start, stop };
}
