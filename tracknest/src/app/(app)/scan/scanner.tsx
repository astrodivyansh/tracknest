"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { tagFrom } from "@/lib/tags";
import { btn, input } from "@/lib/ui";

// Minimal typing for the browser BarcodeDetector API (Chrome/Android, Safari 17+).
type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
  }
}

const REPEAT_MS = 3000; // ignore the same label while it stays in front of the camera

/**
 * Camera + typed/USB-scanner input. Without `onScan` it opens the scanned asset;
 * with it, it keeps scanning and shows what `onScan` returns (used by audits).
 */
export function Scanner({ onScan, submitLabel = "Open" }: { onScan?: (tag: string) => Promise<string>; submitLabel?: string }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onScan);
  const [message, setMessage] = useState("Starting camera…");
  const [cameraOn, setCameraOn] = useState(false);
  // shortcut: no ZXing fallback yet; browsers without BarcodeDetector (Firefox, older iOS) use typed or USB-scanner entry.
  const unsupported = useSyncExternalStore(
    () => () => {},
    () => !window.BarcodeDetector,
    () => false,
  );

  useEffect(() => {
    handler.current = onScan;
  }, [onScan]);

  const handle = async (raw: string) => {
    const tag = tagFrom(raw);
    if (!tag) return;
    if (!handler.current) return router.push(`/a/${encodeURIComponent(tag)}`);
    setMessage(`Checking ${tag}…`);
    setMessage(await handler.current(tag));
  };
  const handleRef = useRef(handle);
  useEffect(() => {
    handleRef.current = handle;
  });

  useEffect(() => {
    if (!window.BarcodeDetector) return;
    const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128"] });
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let last = { value: "", at: 0 };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        void video.current.play();
        setCameraOn(true);
        setMessage("Point the camera at an asset label.");
        timer = setInterval(async () => {
          if (!video.current || video.current.readyState < 2) return;
          const [hit] = await detector.detect(video.current).catch(() => []);
          if (!hit || (hit.rawValue === last.value && Date.now() - last.at < REPEAT_MS)) return;
          last = { value: hit.rawValue, at: Date.now() };
          if (!handler.current) clearInterval(timer);
          void handleRef.current(hit.rawValue);
        }, 300);
      })
      .catch(() => setMessage("Camera not available. Allow camera access, or type the tag below."));
    return () => {
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="space-y-4">
      <video
        ref={video}
        muted
        playsInline
        className={`aspect-square w-full max-w-sm rounded-lg bg-black object-cover ${cameraOn ? "" : "hidden"}`}
      />
      <p role="status" aria-live="polite" className="text-sm text-foreground">
        {unsupported ? "This browser can't scan with the camera. Type the tag below or use a USB scanner." : message}
      </p>
      <form
        className="flex max-w-sm gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void handle(new FormData(form).get("tag")?.toString() ?? "");
          form.reset();
        }}
      >
        <input name="tag" placeholder="Asset tag, e.g. TN-000001" autoFocus aria-label="Asset tag" className={input} />
        <button className={btn}>{submitLabel}</button>
      </form>
    </div>
  );
}
