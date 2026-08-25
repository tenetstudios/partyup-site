"use client";

import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseClient } from "@/lib/supabase";
import {
  createLiveNode,
  fulfillLiveNodeClaim,
  getRoomLiveNodes,
  rotateLiveNodeToken,
  setLiveNodeStatus,
  type LiveNode,
} from "@/lib/liveNodes";

function qrElementId(nodeId: string) {
  return `live-node-qr-${nodeId}`;
}

function posterQrElementId(nodeId: string) {
  return `live-node-poster-qr-${nodeId}`;
}

const posterTemplatePath = "/assets/partyup-live-node-poster.png";
const posterWidth = 1050;
const posterHeight = 1498;
const posterQrSize = 560;
const posterQrX = 245;
const posterQrY = 515;

function sanitizeFilenamePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
    image.src = src;
  });
}

function getQrSvgBlobUrl(elementId: string, size: number) {
  const qrNode = document.getElementById(elementId);
  if (!(qrNode instanceof SVGElement)) return null;

  const clone = qrNode.cloneNode(true) as SVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(size));
  clone.setAttribute("height", String(size));
  const source = new XMLSerializer().serializeToString(clone);
  return URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
}

async function composePosterPngDataUrl(nodeId: string) {
  const qrBlobUrl = getQrSvgBlobUrl(posterQrElementId(nodeId), posterQrSize);
  if (!qrBlobUrl) return null;

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

function downloadQr(node: LiveNode) {
  const element = document.getElementById(qrElementId(node.id));
  if (!(element instanceof SVGElement)) return;
  const blob = new Blob([new XMLSerializer().serializeToString(element)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `partyup-live-node-${sanitizeFilenamePart(node.name) || node.id}-qr.svg`;
  link.click();
  URL.revokeObjectURL(url);
}

function LiveNodePoster({ node, nodeUrl }: { node: LiveNode; nodeUrl: string }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [posterError, setPosterError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void composePosterPngDataUrl(node.id)
        .then((dataUrl) => {
          if (!cancelled && dataUrl) {
            setPreviewUrl(dataUrl);
            setPosterError(null);
          }
        })
        .catch(() => {
          if (!cancelled) setPosterError("Could not generate the poster preview.");
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [node.id, nodeUrl]);

  async function downloadPoster() {
    setPosterError(null);
    try {
      const dataUrl = await composePosterPngDataUrl(node.id);
      if (!dataUrl) throw new Error("Poster QR is not ready");
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `partyup-live-node-${sanitizeFilenamePart(node.name) || node.id}-poster.png`;
      link.click();
    } catch {
      setPosterError("Could not generate the poster. Try again in a moment.");
    }
  }

  return <div className="mt-4 grid gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
    <div className="overflow-hidden rounded-lg border border-fuchsia-300/30 bg-black shadow-xl">
      <Image
        src={previewUrl || posterTemplatePath}
        alt={`PartyUp Live Node poster for ${node.name}`}
        width={posterWidth}
        height={posterHeight}
        unoptimized
        className="h-auto w-full object-contain"
      />
    </div>
    <div className="min-w-0">
      <div className="flex items-start gap-4">
        <div className="shrink-0 rounded-md bg-white p-2">
          <QRCodeSVG id={qrElementId(node.id)} value={nodeUrl} size={148} bgColor="#ffffff" fgColor="#000000" level="H" includeMargin />
        </div>
        <p className="min-w-0 break-all font-mono text-xs text-zinc-400">{nodeUrl}</p>
      </div>
      <p className="mt-3 text-sm leading-6 text-zinc-400">The full-resolution poster includes this node&apos;s secure QR inside the white scan area.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void downloadPoster()} className="rounded-md bg-fuchsia-600 px-4 py-2 text-sm font-black hover:bg-fuchsia-500">Download Node Poster</button>
        <button type="button" onClick={() => downloadQr(node)} className="rounded-md border border-white/15 px-4 py-2 text-sm font-black hover:bg-white/10">Download QR Only</button>
      </div>
      {posterError && <p className="mt-3 text-sm font-bold text-red-300">{posterError}</p>}
    </div>
    <div className="hidden" aria-hidden="true">
      <QRCodeSVG id={posterQrElementId(node.id)} value={nodeUrl} size={posterQrSize} bgColor="#ffffff" fgColor="#000000" level="H" includeMargin />
    </div>
  </div>;
}

export default function LiveNodesManager({ roomId, roomEnded = false }: { roomId: string; roomEnded?: boolean }) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [nodes, setNodes] = useState<LiveNode[]>([]);
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [origin, setOrigin] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("Hidden PartyUp Node");
  const [description, setDescription] = useState("Somewhere in this venue is a hidden PartyUp QR. First person to find it wins.");
  const [reward, setReward] = useState("PartyUp T-shirt");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => setNodes(await getRoomLiveNodes(supabase, roomId)), [roomId, supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      setOrigin(window.location.origin);
      void load().catch(() => undefined);
    });
  }, [load]);

  async function run(nodeId: string, action: () => Promise<unknown>, message: string) {
    setBusyId(nodeId); setError(null); setSuccess(null);
    try { await action(); await load(); setSuccess(message); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update this Live Node."); }
    finally { setBusyId(null); }
  }

  async function submit() {
    setBusyId("create"); setError(null); setSuccess(null);
    try {
      const result = await createLiveNode(supabase, roomId, { name, description, rewardDescription: reward, maxClaims: 1 });
      setTokens((current) => ({ ...current, [result.node.id]: result.claim_token }));
      setCreating(false); await load(); setSuccess("Live Node created. Download its poster before placing it.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the Live Node."); }
    finally { setBusyId(null); }
  }

  async function regenerate(node: LiveNode) {
    if (!window.confirm("Regenerate this QR? Any older printed QR for this Node will stop working.")) return;
    await run(node.id, async () => {
      const result = await rotateLiveNodeToken(supabase, node.id);
      setTokens((current) => ({ ...current, [node.id]: result.claim_token }));
    }, "A new secure poster is ready. Replace any older printout.");
  }

  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-fuchsia-400/20 bg-[#12051e]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4">
        <div><h2 className="font-black">Live Nodes</h2><p className="mt-1 text-sm text-zinc-400">Physical QR claims with server-verified first-winner rewards.</p></div>
        {!roomEnded && <button type="button" onClick={() => setCreating((value) => !value)} className="rounded-md bg-fuchsia-600 px-4 py-2 text-sm font-black hover:bg-fuchsia-500">{creating ? "Cancel" : "Create Node"}</button>}
      </div>

      {creating && <div className="grid gap-3 border-b border-white/10 p-4">
        <label className="text-sm font-bold">Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-1 w-full rounded-md border border-white/10 bg-black/40 p-3 text-white" /></label>
        <label className="text-sm font-bold">Hunt copy<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={3} className="mt-1 w-full rounded-md border border-white/10 bg-black/40 p-3 text-white" /></label>
        <label className="text-sm font-bold">Physical reward<input value={reward} onChange={(event) => setReward(event.target.value)} maxLength={240} className="mt-1 w-full rounded-md border border-white/10 bg-black/40 p-3 text-white" /></label>
        <p className="text-xs text-zinc-500">The reward is descriptive only; staff fulfills it manually.</p>
        <button type="button" disabled={busyId === "create" || !name.trim()} onClick={() => void submit()} className="min-h-11 rounded-md bg-fuchsia-600 px-4 font-black disabled:opacity-50">{busyId === "create" ? "Creating…" : "Create Secure Node"}</button>
      </div>}

      {(error || success) && <p className={`m-4 rounded-md p-3 text-sm font-bold ${error ? "bg-red-950/50 text-red-200" : "bg-emerald-950/40 text-emerald-200"}`}>{error ?? success}</p>}
      <div className="grid gap-4 p-4">
        {!nodes.length && <p className="text-sm text-zinc-500">No Live Nodes created for this room.</p>}
        {nodes.map((node) => {
          const token = tokens[node.id];
          const nodeUrl = token && origin ? `${origin}/n/${token}` : null;
          return <article key={node.id} className="rounded-lg border border-white/10 bg-black/30 p-4">
            <div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-300">{node.status}</p><h3 className="mt-1 text-lg font-black">{node.name}</h3>{node.reward_description && <p className="mt-1 text-sm text-zinc-300">Reward: {node.reward_description}</p>}</div><p className="text-sm font-black">Claims {node.claim_count} / {node.max_claims}</p></div>
            {nodeUrl ? <LiveNodePoster node={node} nodeUrl={nodeUrl} /> : node.status === "draft" || node.status === "armed" ? <p className="mt-3 text-xs text-zinc-500">Secure token ending in {node.token_hint}. Regenerate it if you need a new downloadable poster.</p> : null}
            {node.winner && <div className="mt-4 rounded-md border border-emerald-400/20 bg-emerald-950/20 p-3"><p className="text-xs font-black text-emerald-300">WINNER</p><p className="mt-1 font-black">{node.winner.display_name}</p><p className="text-xs text-zinc-400">Claimed {new Date(node.winner.claimed_at).toLocaleString()}</p><p className="mt-1 text-xs font-bold">{node.winner.fulfilled_at ? "Prize given" : "Prize not yet fulfilled"}</p></div>}
            {!roomEnded && <div className="mt-4 flex flex-wrap gap-2">
              {(node.status === "draft" || node.status === "armed") && <button type="button" disabled={busyId === node.id} onClick={() => void regenerate(node)} className="rounded-md border border-white/15 px-3 py-2 text-sm font-black hover:bg-white/10">Regenerate QR</button>}
              {node.status === "draft" && <button type="button" disabled={busyId === node.id} onClick={() => void run(node.id, () => setLiveNodeStatus(supabase, node.id, "armed"), "Node armed. Its QR is safe to place; claims remain disabled.")} className="rounded-md bg-violet-700 px-3 py-2 text-sm font-black">Arm</button>}
              {node.status === "armed" && <button type="button" disabled={busyId === node.id} onClick={() => void run(node.id, () => setLiveNodeStatus(supabase, node.id, "active"), "Live Node activated and its Mission launched.")} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-black">Activate</button>}
              {!['claimed', 'ended'].includes(node.status) && <button type="button" disabled={busyId === node.id} onClick={() => void run(node.id, () => setLiveNodeStatus(supabase, node.id, "ended"), "Live Node ended.")} className="rounded-md border border-red-400/30 px-3 py-2 text-sm font-black text-red-200">End</button>}
              {node.winner && !node.winner.fulfilled_at && <button type="button" disabled={busyId === node.id} onClick={() => void run(node.id, () => fulfillLiveNodeClaim(supabase, node.id), "Prize fulfillment recorded.")} className="rounded-md bg-amber-500 px-3 py-2 text-sm font-black text-black">Mark Prize Given</button>}
            </div>}
          </article>;
        })}
      </div>
    </section>
  );
}
