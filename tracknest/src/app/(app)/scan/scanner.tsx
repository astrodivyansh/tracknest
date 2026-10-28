"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { btn, input } from "@/lib/ui";

// Minimal typing for the browser BarcodeDetector API (Chrome/Android, Safari 17+).
type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
declare global {
  interface Window {
    BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
  }
}

/** A scanned value may be a full label URL (…/a/TN-000001) or a bare tag. */
function tagFrom(raw: string) {
  const m = raw.match(/\/a\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : raw.trim();
}

export function Scanner() {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("Starting camera…");
  // shortcut: no ZXing fallback yet; browsers without BarcodeDetector (Firefox, older iOS) use manual entry.
  const unsupported = useSyncExternalStore(
    () => () => {},
    () => !window.BarcodeDetector,
    () => false,
  );

  useEffect(() => {
    if (!window.BarcodeDetector) return;
    const detector = new window.BarcodeDetector({ formats: ["qr_code", "code_128"] });
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (!video.current) return;
        video.current.srcObject = s;
        void video.current.play();
        setMessage("Point the camera at an asset label.");
        timer = setInterval(async () => {
          if (!video.current || video.current.readyState < 2) return;
          const [hit] = await detector.detect(video.current).catch(() => []);
          if (hit) {
            clearInterval(timer);
            router.push(`/a/${encodeURIComponent(tagFrom(hit.rawValue))}`);
          }
        }, 300);
      })
      .catch(() => setMessage("Camera not available. Allow camera access, or type the tag below."));
    return () => {
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [router]);

  return (
    <div className="space-y-4">
      <video ref={video} muted playsInline className="aspect-square w-full max-w-sm rounded-lg bg-black object-cover" />
      <p role="status" className="text-sm text-gray-600">
        {unsupported ? "This browser can't scan barcodes. Type the tag below or use a USB scanner." : message}
      </p>
      <form
        className="flex max-w-sm gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = new FormData(e.currentTarget).get("tag")?.toString() ?? "";
          if (v.trim()) router.push(`/a/${encodeURIComponent(tagFrom(v))}`);
        }}
      >
        <input name="tag" placeholder="Asset tag, e.g. TN-000001" autoFocus className={input} />
        <button className={btn}>Open</button>
      </form>
    </div>
  );
}
