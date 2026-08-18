"use client";

import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";

const qrCodeElementId = "partyup-room-entry-qr";
const posterQrCodeElementId = "partyup-room-entry-poster-qr";
const posterTemplatePath = "/assets/partyup-room-poster.png";
const posterWidth = 1054;
const posterHeight = 1492;
const qrBox = { x: 274, y: 697, width: 505, height: 456 };
const posterQrSize = 318;
const posterQrX = qrBox.x + Math.round((qrBox.width - posterQrSize) / 2);
const posterQrY = qrBox.y + Math.round((qrBox.height - posterQrSize) / 2);

function sanitizeFilenamePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function getQrSvgBlobUrl() {
  const qrNode = document.getElementById(posterQrCodeElementId);

  if (!(qrNode instanceof SVGElement)) {
    return null;
  }

  const clone = qrNode.cloneNode(true) as SVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(posterQrSize));
  clone.setAttribute("height", String(posterQrSize));

  const source = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  return URL.createObjectURL(blob);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
    image.src = src;
  });
}

async function composePosterPngDataUrl() {
  const qrBlobUrl = getQrSvgBlobUrl();

  if (!qrBlobUrl) {
    return null;
  }

  try {
    const [posterImage, qrImage] = await Promise.all([
      loadImage(posterTemplatePath),
      loadImage(qrBlobUrl),
    ]);
    const canvas = document.createElement("canvas");
    canvas.width = posterWidth;
    canvas.height = posterHeight;

    const context = canvas.getContext("2d");
    if (!context) return null;

    context.imageSmoothingEnabled = false;
    context.drawImage(posterImage, 0, 0, posterWidth, posterHeight);
    context.fillStyle = "#ffffff";
    context.fillRect(posterQrX, posterQrY, posterQrSize, posterQrSize);
    context.drawImage(qrImage, posterQrX, posterQrY, posterQrSize, posterQrSize);

    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(qrBlobUrl);
  }
}

export default function RoomEntryLinkPanel({ roomId }: { roomId: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [posterPreviewUrl, setPosterPreviewUrl] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      setOrigin(window.location.origin);
    });
  }, []);

  const entryPath = `/join/${encodeURIComponent(roomId)}`;
  const entryUrl = useMemo(() => (origin ? `${origin}${entryPath}` : entryPath), [entryPath, origin]);

  useEffect(() => {
    if (!origin) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      const dataUrl = await composePosterPngDataUrl();
      if (!cancelled && dataUrl) {
        setPosterPreviewUrl(dataUrl);
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [entryUrl, origin]);

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
    link.download = `partyup-room-${sanitizeFilenamePart(roomId) || "room"}-qr.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function printQrPoster() {
    const posterDataUrl = await composePosterPngDataUrl();
    if (!posterDataUrl) return;

    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=720,height=900");
    if (!printWindow) return;

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>PartyUp Room Poster</title>
          <style>
            body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #fff; }
            img { display: block; max-width: 100%; height: auto; }
            @media print { @page { margin: 0.25in; } img { width: 100%; } }
          </style>
        </head>
        <body><img src="${posterDataUrl}" alt="PartyUp room poster" /></body>
      </html>
    `);
    printWindow.document.close();
    window.setTimeout(() => {
      printWindow.print();
    }, 250);
  }

  async function downloadPosterPng() {
    const posterDataUrl = await composePosterPngDataUrl();
    if (!posterDataUrl) return;

    const link = document.createElement("a");
    link.href = posterDataUrl;
    link.download = `partyup-room-${sanitizeFilenamePart(roomId) || "room"}-poster.png`;
    link.click();
  }

  return (
    <section className="mt-8 rounded-xl border border-white/10 bg-[#12051e]">
      <div className="border-b border-white/10 p-4">
        <h2 className="font-black">Venue Entry Link</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Share this stable room link with guests or use it for a venue QR code.
        </p>
      </div>

      <div className="grid gap-5 p-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
        <div className="overflow-hidden rounded-[14px] border border-[#ff3e9a]/45 bg-[#07000f] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
          <div className="grid overflow-hidden rounded-[12px] border border-[#d34cff] bg-black">
            <Image
              src={posterPreviewUrl || posterTemplatePath}
              alt="PartyUp room poster preview"
              width={posterWidth}
              height={posterHeight}
              unoptimized
              className="h-auto w-full object-contain"
            />
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="shrink-0 rounded-[8px] bg-white p-3">
              <QRCodeSVG
                id={qrCodeElementId}
                value={entryUrl}
                size={156}
                bgColor="#ffffff"
                fgColor="#000000"
                level="M"
                includeMargin
                className="h-full w-full"
              />
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <div className="break-all rounded-[8px] border border-white/10 bg-black/40 p-3 font-mono text-sm text-[#d8d1e2]">
                {entryUrl}
              </div>
              <p className="text-sm leading-6 text-zinc-400">
                The poster preview is generated from the approved poster image and this room&apos;s
                unique QR code. The downloaded poster stays full resolution.
              </p>
            </div>
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
              Print CTA Poster
            </button>
            <button
              type="button"
              onClick={downloadPosterPng}
              className="rounded-md border border-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/10"
            >
              Download Poster
            </button>
          </div>
        </div>
      </div>

      <div className="hidden" aria-hidden="true">
        <QRCodeSVG
          id={posterQrCodeElementId}
          value={entryUrl}
          size={posterQrSize}
          bgColor="#ffffff"
          fgColor="#000000"
          level="M"
          includeMargin
        />
      </div>
    </section>
  );
}
