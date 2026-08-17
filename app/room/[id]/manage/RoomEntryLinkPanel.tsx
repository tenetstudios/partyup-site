"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";

const qrCodeElementId = "partyup-room-entry-qr";

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

  function downloadQrSvg() {
    const qrNode = document.getElementById(qrCodeElementId);

    if (!(qrNode instanceof SVGElement)) {
      return;
    }

    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(qrNode);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `partyup-room-${roomId}-qr.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function printQrPoster() {
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=720,height=900");

    if (!printWindow) {
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>PartyUp Room QR</title>
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: #07000f;
              color: white;
              font-family: Arial, Helvetica, sans-serif;
            }
            .poster {
              width: min(92vw, 640px);
              border: 2px solid #8b3dff;
              border-radius: 18px;
              padding: 48px;
              text-align: center;
              background: #12051e;
            }
            .brand {
              font-size: 40px;
              font-weight: 900;
              line-height: 1;
            }
            .brand span { color: #8b3dff; }
            h1 {
              margin: 28px 0 24px;
              font-size: 48px;
              line-height: 1.05;
            }
            .qr {
              display: inline-block;
              padding: 18px;
              border-radius: 16px;
              background: white;
            }
            .url {
              margin: 24px auto 0;
              max-width: 520px;
              overflow-wrap: anywhere;
              color: #d8d1e2;
              font-size: 18px;
              line-height: 1.45;
            }
            @media print {
              body { background: white; }
              .poster {
                border-color: #12051e;
                color: white;
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
              }
            }
          </style>
        </head>
        <body>
          <main class="poster">
            <div class="brand">party<span>up</span>.io</div>
            <h1>Scan to join the room</h1>
            <div class="qr">${document.getElementById(qrCodeElementId)?.outerHTML ?? ""}</div>
            <p class="url">${entryUrl}</p>
          </main>
          <script>
            window.addEventListener("load", () => {
              window.print();
            });
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
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
            id={qrCodeElementId}
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
            <button
              type="button"
              onClick={downloadQrSvg}
              className="rounded-md border border-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/10"
            >
              Download QR
            </button>
            <button
              type="button"
              onClick={printQrPoster}
              className="rounded-md border border-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/10"
            >
              Print Poster
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
