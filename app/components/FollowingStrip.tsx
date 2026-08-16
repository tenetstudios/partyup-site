import React from "react";
import { HostProfile } from "@/lib/homeHelpers";

export default function FollowingStrip({ profiles }: { profiles?: HostProfile[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-[#12051e] p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-black uppercase tracking-[0.12em] text-purple-200">People You Follow</h4>
        <a className="text-sm text-pink-400 hover:underline" href="#">View all</a>
      </div>

      <div className="mt-4">
        {profiles && profiles.length > 0 ? (
          <div className="flex items-center gap-4 overflow-x-auto py-2">
            {profiles.map((p) => (
              <div key={String(p.id)} className="flex flex-col items-center gap-2">
                <div className="relative">
                  <img src={String(p.avatar_url ?? p.image_url ?? '')} alt={String(p.username ?? p.display_name ?? '')} className="h-12 w-12 rounded-full object-cover" />
                  <span className="absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-[#0b0410] bg-green-400" />
                </div>
                <div className="text-xs font-bold text-zinc-200">{String(p.username ?? p.display_name ?? 'user')}</div>
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
