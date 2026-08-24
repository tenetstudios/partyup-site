"use client";

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

function downloadQr(node: LiveNode) {
  const element = document.getElementById(qrElementId(node.id));
  if (!(element instanceof SVGElement)) return;
  const blob = new Blob([new XMLSerializer().serializeToString(element)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `partyup-live-node-${node.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || node.id}.svg`;
  link.click();
  URL.revokeObjectURL(url);
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
      setCreating(false); await load(); setSuccess("Live Node created. Download its QR before placing it.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the Live Node."); }
    finally { setBusyId(null); }
  }

  async function regenerate(node: LiveNode) {
    if (!window.confirm("Regenerate this QR? Any older printed QR for this Node will stop working.")) return;
    await run(node.id, async () => {
      const result = await rotateLiveNodeToken(supabase, node.id);
      setTokens((current) => ({ ...current, [node.id]: result.claim_token }));
    }, "A new secure QR is ready. Replace any older printout.");
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
            {nodeUrl ? <div className="mt-4 flex flex-wrap items-center gap-4"><div className="rounded-md bg-white p-2"><QRCodeSVG id={qrElementId(node.id)} value={nodeUrl} size={148} level="H" includeMargin /></div><div><p className="max-w-sm break-all font-mono text-xs text-zinc-400">{nodeUrl}</p><button type="button" onClick={() => downloadQr(node)} className="mt-3 rounded-md border border-white/15 px-4 py-2 text-sm font-black hover:bg-white/10">Download QR</button></div></div> : node.status === "draft" || node.status === "armed" ? <p className="mt-3 text-xs text-zinc-500">Secure token ending in {node.token_hint}. Regenerate only if you need a new downloadable copy.</p> : null}
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
