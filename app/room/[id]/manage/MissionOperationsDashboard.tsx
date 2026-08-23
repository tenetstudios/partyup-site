import type { MissionOperationsDashboard as DashboardData } from "@/lib/roomMissions";

const statusCopy: Record<DashboardData["operational_status"], { label: string; className: string; detail: string }> = {
  healthy: {
    label: "Healthy",
    className: "border-emerald-400/30 bg-emerald-950/30 text-emerald-200",
    detail: "Groups are balanced and currently have enough members.",
  },
  waiting_for_participants: {
    label: "Waiting",
    className: "border-zinc-400/25 bg-zinc-900/40 text-zinc-200",
    detail: "No participant activity has been recorded yet.",
  },
  needs_people: {
    label: "Needs people",
    className: "border-amber-300/30 bg-amber-950/30 text-amber-100",
    detail: "At least one group does not have enough members for everyone to finish.",
  },
  imbalanced: {
    label: "Imbalanced",
    className: "border-orange-300/30 bg-orange-950/30 text-orange-100",
    detail: "The largest and smallest groups differ by more than one participant.",
  },
  ended: {
    label: "Ended",
    className: "border-zinc-400/25 bg-zinc-900/40 text-zinc-300",
    detail: "Historical results are read-only.",
  },
};

export default function MissionOperationsDashboard({ dashboard }: { dashboard: DashboardData }) {
  const status = statusCopy[dashboard.operational_status];
  const largestGroup = Math.max(1, ...dashboard.groups.map((group) => group.participant_count));

  return (
    <section className="mt-4 rounded-lg border border-white/10 bg-[#08080d] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-purple-300">Mission Operations</p>
          <p className="mt-1 text-xs text-zinc-500">
            Aggregate host metrics · Updated {new Date(dashboard.generated_at).toLocaleTimeString()}
          </p>
        </div>
        <div className={`rounded-md border px-3 py-2 text-xs font-black ${status.className}`}>
          {status.label}
        </div>
      </div>
      <p className="mt-3 text-sm text-zinc-300">{status.detail}</p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Participants" value={dashboard.summary.participant_count} />
        <Metric label="Completed" value={dashboard.summary.completed_count} />
        <Metric label="Completion" value={`${dashboard.summary.completion_rate}%`} />
        <Metric label="Encounters" value={dashboard.summary.encounter_count} />
      </div>

      {dashboard.groups.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-black uppercase text-zinc-300">Groups</h4>
            <span className="text-xs font-bold text-zinc-500">
              Spread {dashboard.summary.assignment_spread}
              {dashboard.minimum_group_size ? ` · Minimum ${dashboard.minimum_group_size} per group` : ""}
            </span>
          </div>
          <div className="mt-3 space-y-3">
            {dashboard.groups.map((group) => (
              <div key={group.assignment_key} className="rounded-md bg-white/[0.04] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full bg-purple-400"
                      style={group.color ? { backgroundColor: group.color } : undefined}
                    />
                    <span className="truncate font-black text-white">{group.label}</span>
                    {group.underfilled && <span className="rounded bg-amber-900/60 px-2 py-0.5 text-[10px] font-black uppercase text-amber-100">Underfilled</span>}
                  </div>
                  <span className="shrink-0 text-sm font-black text-zinc-200">{group.participant_count}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-purple-500"
                    style={{
                      backgroundColor: group.color ?? undefined,
                      width: `${Math.max(group.participant_count > 0 ? 4 : 0, (group.participant_count / largestGroup) * 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  {group.completed_count} completed · {group.encounter_count} encounters
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {dashboard.summary.unassigned_participant_count > 0 && (
        <p className="mt-3 text-xs font-bold text-amber-200">
          {dashboard.summary.unassigned_participant_count} known participant{dashboard.summary.unassigned_participant_count === 1 ? "" : "s"} currently lack a group assignment.
        </p>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-white/[0.05] p-3">
      <p className="text-xs font-bold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-black text-white">{value}</p>
    </div>
  );
}
