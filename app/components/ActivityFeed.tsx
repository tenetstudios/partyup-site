import React from "react";

export default function ActivityFeed({ items }: { items?: unknown[] }) {
  return (
    <aside className="rounded-lg border border-white/10 bg-[#0e0714] p-4">
      <h4 className="text-sm font-black uppercase tracking-[0.12em] text-purple-200">Activity Feed</h4>
      <div className="mt-4">
        {items && items.length > 0 ? (
          <ul className="space-y-3">
            {items.map((it, idx) => (
              <li key={idx} className="text-sm text-zinc-300">{String(JSON.stringify(it))}</li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-purple-300/20 p-4 text-sm text-zinc-400">No recent activity.</div>
        )}
      </div>
    </aside>
  );
}
