"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState } from "react";

const qrCodeElementId = "partyup-room-entry-qr";
const posterQrCodeElementId = "partyup-room-entry-poster-qr";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getQrSvgMarkup() {
  const qrNode = document.getElementById(posterQrCodeElementId);
  return qrNode instanceof SVGElement ? qrNode.outerHTML : "";
}

function buildPosterHtml(entryUrl: string, qrSvgMarkup: string) {
  const safeEntryUrl = escapeHtml(entryUrl);

  return `
    <!doctype html>
    <html>
      <head>
        <title>PartyUp Room Poster</title>
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
            position: relative;
            width: min(92vw, 720px);
            aspect-ratio: 1080 / 1530;
            overflow: hidden;
            border: 2px solid #d34cff;
            border-radius: 34px;
            padding: 54px 56px 36px;
            text-align: center;
            background:
              radial-gradient(circle at 8% 51%, rgba(255, 47, 145, 0.72), transparent 18%),
              radial-gradient(circle at 91% 50%, rgba(145, 70, 255, 0.72), transparent 20%),
              radial-gradient(circle at 50% 72%, rgba(255, 47, 145, 0.18), transparent 24%),
              linear-gradient(180deg, #12001f 0%, #090012 64%, #07000f 100%);
            box-shadow: inset 0 0 80px rgba(145, 70, 255, 0.18);
          }
          .poster::before {
            content: "";
            position: absolute;
            inset: 42% 0 18%;
            background:
              linear-gradient(100deg, transparent 0 8%, rgba(255, 47, 145, 0.28) 8.3% 9.4%, transparent 9.8%),
              linear-gradient(78deg, transparent 0 85%, rgba(145, 70, 255, 0.30) 85.4% 86.4%, transparent 86.8%),
              radial-gradient(ellipse at 50% 100%, rgba(0, 0, 0, 0.86), transparent 58%);
            opacity: 0.92;
          }
          .poster > * { position: relative; z-index: 1; }
          .brand {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            font-size: 52px;
            font-weight: 900;
            line-height: 1;
          }
          .mark {
            position: relative;
            width: 74px;
            height: 66px;
          }
          .mark::before,
          .mark::after {
            content: "";
            position: absolute;
            top: 0;
            width: 24px;
            height: 24px;
            border-radius: 999px;
            background: #ff3e9a;
          }
          .mark::before { left: 9px; }
          .mark::after { right: 9px; }
          .legs {
            position: absolute;
            bottom: 0;
            left: 7px;
            right: 7px;
            height: 42px;
            border-radius: 24px 24px 8px 8px;
            background: linear-gradient(135deg, #ff3e9a, #9a46ff);
          }
          .legs::after {
            content: "";
            position: absolute;
            left: 50%;
            top: 0;
            width: 15px;
            height: 42px;
            transform: translateX(-50%);
            background: #12001f;
          }
          .brand span { color: #ff3e9a; }
          .headline {
            margin: 48px 0 0;
            font-size: clamp(76px, 14vw, 124px);
            font-weight: 900;
            letter-spacing: 0;
            line-height: 0.92;
            text-shadow: 0 5px 0 rgba(255,255,255,0.08), 0 16px 42px rgba(0,0,0,0.54);
          }
          .headline .white { color: #fff; display: block; }
          .headline .pink {
            display: block;
            background: linear-gradient(180deg, #ff3e9a, #9146ff);
            -webkit-background-clip: text;
            color: transparent;
          }
          .scan-line {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 26px;
            margin: 44px 0 26px;
            font-size: 28px;
            font-weight: 900;
            letter-spacing: 0.1em;
          }
          .scan-line::before,
          .scan-line::after {
            content: "";
            width: 62px;
            height: 2px;
            background: #ff3e9a;
          }
          .qr-row {
            display: grid;
            grid-template-columns: 154px minmax(0, 1fr) 154px;
            align-items: center;
            gap: 30px;
          }
          .side-callout {
            display: grid;
            gap: 16px;
            justify-items: center;
            color: white;
            font-size: 22px;
            font-weight: 900;
            line-height: 1.25;
          }
          .side-callout svg {
            width: 82px;
            height: 82px;
            color: #ff3e9a;
          }
          .side-callout strong {
            display: block;
            color: #ff3e9a;
          }
          .qr-card {
            min-height: 426px;
            border-radius: 48px;
            display: grid;
            place-items: center;
            background: #fff;
            box-shadow: 0 0 0 7px rgba(255, 62, 154, 0.88), 0 0 0 12px rgba(145,70,255,0.88), 0 22px 68px rgba(255, 47, 145, 0.45);
          }
          .qr-card svg {
            width: 330px;
            height: 330px;
          }
          .feature-bar {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 0;
            margin: 44px auto 32px;
            border: 1px solid rgba(255, 62, 154, 0.74);
            border-radius: 34px;
            background: rgba(18, 5, 30, 0.82);
            overflow: hidden;
          }
          .feature {
            min-height: 164px;
            display: grid;
            place-items: center;
            padding: 20px;
            border-right: 1px solid rgba(145, 70, 255, 0.7);
          }
          .feature:last-child { border-right: 0; }
          .feature svg {
            width: 56px;
            height: 56px;
            color: #ff3e9a;
            margin-bottom: 10px;
          }
          .feature h2 {
            margin: 0;
            color: #ff3e9a;
            font-size: 22px;
            line-height: 1;
          }
          .feature p {
            margin: 8px 0 0;
            color: white;
            font-size: 18px;
            line-height: 1.25;
          }
          .footer {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 18px;
            font-size: 24px;
            letter-spacing: 0.06em;
            text-transform: uppercase;
          }
          .footer span { color: #ff3e9a; }
          .url {
            margin: 18px auto 0;
            max-width: 720px;
            overflow-wrap: anywhere;
            color: rgba(255,255,255,0.74);
            font-size: 15px;
            line-height: 1.4;
          }
          @media print {
            @page { margin: 0.25in; }
            body { background: white; }
            .poster {
              width: 100%;
              max-width: 7.8in;
              print-color-adjust: exact;
              -webkit-print-color-adjust: exact;
            }
          }
        </style>
      </head>
      <body>
        <main class="poster">
          <div class="brand"><span class="mark"><span class="legs"></span></span>party<span>up</span></div>
          <div class="headline"><span class="white">SEE</span><span class="pink">WHO'S</span><span class="pink">HERE</span></div>
          <div class="scan-line">SCAN TO JOIN THIS ROOM</div>
          <section class="qr-row">
            <div class="side-callout">
              <svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="23" cy="20" r="9" stroke="currentColor" stroke-width="4"/><circle cx="43" cy="20" r="9" stroke="currentColor" stroke-width="4"/><path d="M9 54c1-12 9-18 20-18s19 6 20 18" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M34 36c9 0 16 6 17 18" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>
              <div>MEET<br />PEOPLE<br /><strong>HERE</strong></div>
            </div>
            <div class="qr-card">${qrSvgMarkup}</div>
            <div class="side-callout">
              <svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M10 29c0-11 10-19 22-19s22 8 22 19-10 19-22 19c-4 0-8-.8-11-2l-10 6 3-11c-3-3-4-7-4-12Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M24 29h.1M32 29h.1M40 29h.1" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg>
              <div>REAL<br />CONVERSATIONS<br /><strong>IN REAL TIME</strong></div>
            </div>
          </section>
          <section class="feature-bar">
            <div class="feature"><svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="24" cy="22" r="9" stroke="currentColor" stroke-width="4"/><circle cx="42" cy="23" r="8" stroke="currentColor" stroke-width="4"/><path d="M10 54c1-11 8-17 18-17s17 6 18 17" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M36 40c7 1 13 6 14 14" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg><div><h2>MATCH</h2><p>Find someone<br />new.</p></div></div>
            <div class="feature"><svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M9 29c0-10 9-18 21-18s21 8 21 18-9 18-21 18c-4 0-7-.7-10-2l-9 5 3-10c-3-3-5-7-5-11Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M51 25c4 3 6 7 6 12 0 4-2 8-5 11l2 8-8-4c-4 2-9 2-13 1" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M23 29h.1M30 29h.1M37 29h.1" stroke="currentColor" stroke-width="6" stroke-linecap="round"/></svg><div><h2>CHAT</h2><p>Talk, share,<br />connect.</p></div></div>
            <div class="feature"><svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><rect x="8" y="18" width="34" height="28" rx="5" stroke="currentColor" stroke-width="4"/><path d="m42 27 14-8v26l-14-8" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg><div><h2>GO LIVE</h2><p>Share the moment<br />with the room.</p></div></div>
          </section>
          <div class="footer">SAFE. RESPECTFUL. ANONYMOUS. <span>| GOOD VIBES ONLY.</span></div>
          <p class="url">${safeEntryUrl}</p>
        </main>
      </body>
    </html>
  `;
}

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

    printWindow.document.write(buildPosterHtml(entryUrl, getQrSvgMarkup()));
    printWindow.document.close();
    window.setTimeout(() => {
      printWindow.print();
    }, 250);
  }

  function downloadPosterHtml() {
    const source = buildPosterHtml(entryUrl, getQrSvgMarkup());
    const blob = new Blob([source], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `partyup-room-${roomId}-poster.html`;
    link.click();
    URL.revokeObjectURL(url);
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
          <div className="rounded-[12px] border border-[#d34cff] bg-[radial-gradient(circle_at_8%_52%,rgba(255,47,145,0.55),transparent_22%),radial-gradient(circle_at_92%_52%,rgba(145,70,255,0.55),transparent_22%),linear-gradient(180deg,#12001f,#07000f)] px-5 py-6 text-center">
            <div className="text-xl font-black">
              party<span className="text-[#ff3e9a]">up</span>
            </div>
            <div className="mt-5 text-[44px] font-black leading-[0.9]">
              <span className="block">SEE</span>
              <span className="block bg-gradient-to-b from-[#ff3e9a] to-[#9146ff] bg-clip-text text-transparent">
                WHO&apos;S
              </span>
              <span className="block bg-gradient-to-b from-[#ff3e9a] to-[#9146ff] bg-clip-text text-transparent">
                HERE
              </span>
            </div>
            <div className="my-5 text-[10px] font-black uppercase tracking-[0.2em] text-white">
              Scan to join this room
            </div>
            <div className="mx-auto grid h-36 w-36 place-items-center rounded-[20px] bg-white p-3 shadow-[0_0_0_3px_#ff3e9a,0_0_0_6px_#9146ff]">
              <QRCodeSVG
                id={posterQrCodeElementId}
                value={entryUrl}
                size={112}
                bgColor="#ffffff"
                fgColor="#12051e"
                level="M"
                includeMargin
                className="h-full w-full"
              />
            </div>
            <div className="mt-5 grid grid-cols-3 rounded-[10px] border border-[#ff3e9a]/60 py-3 text-[10px] font-black text-[#ff3e9a]">
              <span>MATCH</span>
              <span>CHAT</span>
              <span>GO LIVE</span>
            </div>
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
                fgColor="#12051e"
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
                The poster preview uses this room&apos;s unique QR code. Print it directly or
                download the poster file for a designer or print shop.
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
              onClick={downloadPosterHtml}
              className="rounded-md border border-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/10"
            >
              Download Poster
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
