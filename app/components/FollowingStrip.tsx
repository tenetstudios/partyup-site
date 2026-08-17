import React from "react";
import { HostProfile } from "@/lib/homeHelpers";

export default function FollowingStrip({ profiles }: { profiles?: HostProfile[] }) {
  const visibleProfiles = profiles?.slice(0, 5) ?? [];

  return (
    <div className="min-h-[203px] rounded-[10px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(17,17,27,0.94),rgba(11,11,19,0.96))] p-5 shadow-[0_18px_44px_rgba(0,0,0,0.2)]">
      <div className="flex items-center justify-between">
        <h4 className="text-[18px] font-black text-white">People You Follow</h4>
        <a className="text-[15px] text-[#c35dff] hover:text-white" href="#">View all</a>
      </div>

      <div className="mt-4">
        {visibleProfiles.length > 0 ? (
          <div className="flex items-start justify-between gap-3 overflow-x-auto py-2">
            {visibleProfiles.map((p) => (
              <div key={String(p.id)} className="flex min-w-[58px] flex-col items-center">
                <div className="relative rounded-full bg-gradient-to-br from-[#ff2d9a] to-[#8b3dff] p-[3px]">
                  <img src={String(p.avatar_url ?? p.image_url ?? "")} alt={String(p.username ?? p.display_name ?? "")} className="h-[58px] w-[58px] rounded-full border-2 border-[#10101a] object-cover" />
                </div>
                <div className="mt-2 max-w-[68px] truncate text-[15px] font-semibold text-white">{String(p.username ?? p.display_name ?? "user")}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-h-[112px] place-items-center rounded-[10px] border border-dashed border-purple-300/20 bg-black/10 px-5 text-center">
            <p className="max-w-[260px] text-sm leading-6 text-[#aaa4b8]">Follow people from live rooms and they will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
