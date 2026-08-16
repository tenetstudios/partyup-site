import React from "react";

export default function ActivityFeed({ items }: { items?: unknown[] }) {
  return (
    <aside className="rounded-lg border border-white/10 bg-[#0e0714] p-6">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-black uppercase tracking-[0.12em] text-purple-200">Activity Feed</h4>
        <a className="text-sm text-pink-400 hover:underline" href="#">View all</a>
      </div>

      <div className="mt-4">
        {items && items.length > 0 ? (
          <ul className="space-y-3 max-h-80 overflow-auto pr-2">
            {items.map((it, idx) => (
              <li key={idx} className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-md bg-gradient-to-br from-purple-600 to-pink-500" />
                <div className="text-sm text-zinc-300">{String(JSON.stringify(it))}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-purple-300/20 p-4 text-sm text-zinc-400">No recent activity.</div>
        )}
      </div>
    </aside>
  );
}
