import React from "react";
import { HostProfile } from "@/lib/homeHelpers";

export default function FollowingStrip({ profiles }: { profiles?: HostProfile[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#12051e] p-4">
      <h4 className="text-sm font-black uppercase tracking-[0.12em] text-purple-200">People You Follow</h4>
      <div className="mt-4">
        {profiles && profiles.length > 0 ? (
          <div className="flex gap-3 overflow-x-auto">
            {profiles.map((p) => (
              <div key={String(p.id)} className="flex w-36 flex-col items-center gap-2 rounded-md bg-black/20 p-3">
                <div className="h-10 w-10 rounded-full bg-[#9146ff]" />
                <div className="text-sm font-black">{String(p.username ?? p.display_name ?? "user")}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-purple-300/20 p-4 text-sm text-zinc-400">You aren't following anyone yet.</div>
        )}
      </div>
    </div>
  );
}
