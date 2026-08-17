"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";

export default function RoomEntryLinkPanel({ roomId }: { roomId: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setOrigin(window.location.origin);
    });
  }, []);

  const entryPath = `/join/${encodeURIComponent(roomId)}`;
  const entryUrl = useMemo(() => (origin ? `${origin}${entryPath}` : entryPath), [entryPath, origin]);

  async function copyLink() {
    await navigator.clipboard.writeText(entryUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="mt-8 rounded-xl border border-white/10 bg-[#12051e]">
      <div className="border-b border-white/10 p-4">
        <h2 className="font-black">Venue Entry Link</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Share this stable room link with guests or use it for a venue QR code.
        </p>
      </div>

      <div className="grid gap-5 p-4 md:grid-cols-[180px_minmax(0,1fr)] md:items-start">
        <div className="rounded-[8px] bg-white p-3">
          <QRCodeSVG
            value={entryUrl}
            size={156}
            bgColor="#ffffff"
            fgColor="#12051e"
            level="M"
            includeMargin
            className="h-full w-full"
          />
        </div>

        <div className="min-w-0 space-y-4">
          <div className="break-all rounded-[8px] border border-white/10 bg-black/40 p-3 font-mono text-sm text-[#d8d1e2]">
            {entryUrl}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={copyLink}
              className="rounded-md bg-[#9146ff] px-4 py-2 text-sm font-black text-white hover:bg-[#7b31e8]"
            >
              {copied ? "Copied" : "Copy Entry Link"}
            </button>
            <a
              href={entryPath}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/10"
            >
              Test Link
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
