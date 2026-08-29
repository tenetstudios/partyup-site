"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { createSupabaseClient } from "@/lib/supabase";
import TriviaQuestionBankAdmin from "./TriviaQuestionBankAdmin";

type DashboardCounts = {
  users: number;
  open_reports: number;
  active_rooms: number;
  live_rooms: number;
  failed_deletions: number;
};

type ReportRow = {
  id: string;
  room_id: string;
  message_id: string;
  reported_user_id: string | null;
  reason: string;
  details: string | null;
  message_snapshot: string;
  display_name_snapshot: string | null;
  status: string;
  resolution: string | null;
  created_at: string;
  reviewed_at: string | null;
  room_title: string;
};

type UserRow = {
  id: string;
  email: string | null;
  username: string | null;
  avatar_url: string | null;
  admin_role: string | null;
  created_at: string;
  last_sign_in_at: string | null;
};

type RoomRow = {
  id: string;
  host_id: string | null;
  host_username: string | null;
  title: string;
  status: string;
  is_private: boolean;
  current_users: number;
  queue_count: number;
  is_live: boolean;
  active_publisher_count: number;
  signal_source: string | null;
  live_state_updated_at: string | null;
  last_active_at: string | null;
};

type DeletionRow = {
  request_id: string;
  account_fingerprint: string;
  status: string;
  requested_at: string;
  completed_at: string | null;
  last_error: string | null;
};

type AuditRow = {
  id: number;
  admin_user_id: string;
  admin_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  reason: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type AdminDashboardData = {
  counts: DashboardCounts;
  reports: ReportRow[];
  users: UserRow[];
  rooms: RoomRow[];
  deletion_requests: DeletionRow[];
  audit_log: AuditRow[];
};

const emptyDashboard: AdminDashboardData = {
  counts: {
    users: 0,
    open_reports: 0,
    active_rooms: 0,
    live_rooms: 0,
    failed_deletions: 0,
  },
  reports: [],
  users: [],
  rooms: [],
  deletion_requests: [],
  audit_log: [],
};

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function requestReason(action: string) {
  const reason = window.prompt(`Reason for ${action} (required, 5–500 characters):`)?.trim() ?? "";
  if (reason.length < 5 || reason.length > 500) {
    window.alert("Enter a reason between 5 and 500 characters.");
    return null;
  }
  return reason;
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "danger" }) {
  const tones = {
    neutral: "border-white/15 bg-white/5 text-[#c9c4d2]",
    good: "border-emerald-300/25 bg-emerald-500/10 text-emerald-200",
    warn: "border-amber-300/25 bg-amber-500/10 text-amber-100",
    danger: "border-red-300/25 bg-red-500/10 text-red-200",
  };

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${tones[tone]}`}>{children}</span>;
}

export default function AdminDashboard() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [access, setAccess] = useState<"loading" | "granted" | "denied">("loading");
  const [dashboard, setDashboard] = useState<AdminDashboardData>(emptyDashboard);
  const [userSearch, setUserSearch] = useState("");
  const [roomSearch, setRoomSearch] = useState("");
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const loadDashboard = useCallback(async (userQuery = "", roomQuery = "") => {
    setError("");
    const { data, error: dashboardError } = await supabase.rpc("get_site_admin_dashboard_v2", {
      p_room_search: roomQuery || null,
      p_user_search: userQuery || null,
    });

    if (dashboardError) {
      setError(dashboardError.message);
      return;
    }

    setDashboard((data as AdminDashboardData | null) ?? emptyDashboard);
  }, [supabase]);

  useEffect(() => {
    let active = true;

    async function authorize() {
      const { data: authData } = await supabase.auth.getUser();
      if (!active) return;

      if (!authData.user) {
        setAccess("denied");
        return;
      }

      const { data: isAdmin, error: accessError } = await supabase.rpc("is_site_admin");
      if (!active) return;

      if (accessError || isAdmin !== true) {
        setAccess("denied");
        return;
      }

      setAccess("granted");
      await loadDashboard();
    }

    void authorize();
    return () => { active = false; };
  }, [loadDashboard, supabase]);

  async function reviewReport(reportId: string, action: "dismiss" | "remove_message" | "mute_5m") {
    const labels = {
      dismiss: "dismissing this report",
      remove_message: "removing this message",
      mute_5m: "muting this participant for five minutes",
    };
    const reason = requestReason(labels[action]);
    if (!reason || !window.confirm(`Confirm ${labels[action]}? This action will be audited.`)) return;

    setBusyAction(`report:${reportId}`);
    setError("");
    const { error: actionError } = await supabase.rpc("admin_review_room_message_report", {
      p_action: action,
      p_reason: reason,
      p_report_id: reportId,
    });
    setBusyAction("");

    if (actionError) {
      if (actionError instanceof FunctionsHttpError) {
        const response = await actionError.context.json().catch(() => null) as { error?: string } | null;
        setError(response?.error || actionError.message);
      } else {
        setError(actionError.message);
      }
      return;
    }

    await loadDashboard(userSearch, roomSearch);
  }

  async function manageRoom(room: RoomRow, action: "clear" | "end") {
    const reason = requestReason(`${action === "clear" ? "clearing" : "ending"} ${room.title}`);
    if (!reason) return;

    let participantMessage: string | null = null;
    if (action === "clear") {
      participantMessage = window.prompt("Optional message shown to removed participants:")?.trim() || null;
      if (participantMessage && participantMessage.length > 500) {
        window.alert("The participant message must be 500 characters or fewer.");
        return;
      }
    }

    const warning = action === "clear"
      ? `Clear all participants from “${room.title}”? This cannot be undone.`
      : `Permanently end “${room.title}”? An ended room cannot be reopened.`;
    if (!window.confirm(warning)) return;

    setBusyAction(`room:${room.id}`);
    setError("");
    const { error: actionError } = await supabase.rpc("admin_manage_event_room", {
      p_action: action,
      p_participant_message: participantMessage,
      p_reason: reason,
      p_room_id: room.id,
    });
    setBusyAction("");

    if (actionError) {
      if (actionError instanceof FunctionsHttpError) {
        const response = await actionError.context.json().catch(() => null) as { error?: string } | null;
        setError(response?.error || actionError.message);
      } else {
        setError(actionError.message);
      }
      return;
    }

    await loadDashboard(userSearch, roomSearch);
  }

  async function deleteRoom(room: RoomRow) {
    const reason = requestReason(`permanently deleting ${room.title}`);
    if (!reason) return;

    const confirmation = window.prompt(
      `This permanently deletes “${room.title}”, its content, Memories, and event history. Type DELETE to continue:`,
    );
    if (confirmation !== "DELETE") {
      if (confirmation !== null) window.alert("Room deletion cancelled. You must type DELETE exactly.");
      return;
    }

    if (!window.confirm(`Final confirmation: permanently delete “${room.title}”? This cannot be undone.`)) return;

    setBusyAction(`room:${room.id}`);
    setError("");
    const { data, error: actionError } = await supabase.functions.invoke("admin-delete-room", {
      body: {
        confirmation,
        reason,
        roomId: room.id,
      },
    });
    setBusyAction("");

    if (actionError) {
      if (actionError instanceof FunctionsHttpError) {
        const response = await actionError.context.json().catch(() => null) as { error?: string } | null;
        setError(response?.error || actionError.message);
      } else {
        setError(actionError.message);
      }
      return;
    }

    const result = data as { cleanup_complete?: boolean; cleanup_errors?: string[] } | null;
    if (result?.cleanup_complete === false) {
      setError(`Room deleted, but some media cleanup needs attention: ${(result.cleanup_errors ?? []).join("; ")}`);
    }

    await loadDashboard(userSearch, roomSearch);
  }

  if (access === "loading") {
    return <div className="mx-auto max-w-7xl px-5 py-20 text-center text-[#aaa4b8]">Checking administrator access…</div>;
  }

  if (access === "denied") {
    return (
      <section className="mx-auto grid min-h-[65vh] max-w-xl place-items-center px-5 text-center">
        <div className="rounded-xl border border-red-300/20 bg-[#150b18] p-8">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-red-300">Restricted</p>
          <h1 className="mt-3 text-3xl font-black">Administrator access required</h1>
          <p className="mt-3 text-[#aaa4b8]">This account is not authorized to access PartyUp administration.</p>
          <Link href="/" className="mt-6 inline-flex rounded-md bg-[#9146ff] px-5 py-3 font-black">Return home</Link>
        </div>
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-10">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#c38cff]">PartyUp operations</p>
          <h1 className="mt-2 text-4xl font-black">Admin control panel</h1>
          <p className="mt-2 text-[#aaa4b8]">Moderation, rooms, users, live-state health, and audited operations.</p>
        </div>
        <button type="button" onClick={() => void loadDashboard(userSearch, roomSearch)} className="rounded-md border border-white/15 px-4 py-3 text-sm font-black hover:bg-white/10">Refresh data</button>
      </div>

      {error && <div role="alert" className="mt-6 rounded-lg border border-red-300/25 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100">{error}</div>}

      <section className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Users", dashboard.counts.users],
          ["Open reports", dashboard.counts.open_reports],
          ["Active rooms", dashboard.counts.active_rooms],
          ["Live rooms", dashboard.counts.live_rooms],
          ["Failed deletions", dashboard.counts.failed_deletions],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-white/10 bg-[#120b1a] p-5 shadow-xl">
            <p className="text-xs font-black uppercase tracking-[0.12em] text-[#8f889b]">{label}</p>
            <p className="mt-2 text-3xl font-black">{value}</p>
          </div>
        ))}
      </section>

      <TriviaQuestionBankAdmin supabase={supabase} />

      <section id="reports" className="mt-10 rounded-xl border border-white/10 bg-[#100a17] p-5 md:p-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black">Message reports</h2>
            <p className="mt-1 text-sm text-[#aaa4b8]">Open reports appear first. Every decision requires an audit reason.</p>
          </div>
          <StatusPill tone={dashboard.counts.open_reports > 0 ? "warn" : "good"}>{dashboard.counts.open_reports} open</StatusPill>
        </div>
        <div className="mt-5 grid gap-4">
          {dashboard.reports.length === 0 && <p className="rounded-lg border border-dashed border-white/15 p-6 text-center text-[#8f889b]">No reports found.</p>}
          {dashboard.reports.map((report) => (
            <article key={report.id} className="rounded-lg border border-white/10 bg-black/20 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={report.status === "open" ? "warn" : "neutral"}>{report.status}</StatusPill>
                    <span className="text-sm font-black text-purple-200">{report.room_title}</span>
                    <span className="text-xs text-[#777180]">{formatDate(report.created_at)}</span>
                  </div>
                  <p className="mt-3 text-sm font-black uppercase tracking-wide text-[#ff83b8]">{report.reason.replaceAll("_", " ")}</p>
                </div>
                <Link href={`/room/${report.room_id}`} className="text-sm font-black text-purple-300 hover:text-purple-200">Open room</Link>
              </div>
              <blockquote className="mt-4 rounded-md border-l-4 border-purple-500 bg-white/[0.04] px-4 py-3 text-[#e8e4ed]">“{report.message_snapshot}”</blockquote>
              <p className="mt-2 text-sm text-[#aaa4b8]">Posted as {report.display_name_snapshot || "Unknown user"}{report.details ? ` · Reporter notes: ${report.details}` : ""}</p>
              {report.status === "open" ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button disabled={busyAction === `report:${report.id}`} onClick={() => void reviewReport(report.id, "remove_message")} className="rounded-md bg-red-600 px-4 py-2 text-sm font-black hover:bg-red-500 disabled:opacity-50">Remove message</button>
                  <button disabled={busyAction === `report:${report.id}`} onClick={() => void reviewReport(report.id, "mute_5m")} className="rounded-md border border-amber-300/25 bg-amber-500/10 px-4 py-2 text-sm font-black text-amber-100 hover:bg-amber-500/20 disabled:opacity-50">Mute 5m</button>
                  <button disabled={busyAction === `report:${report.id}`} onClick={() => void reviewReport(report.id, "dismiss")} className="rounded-md border border-white/15 px-4 py-2 text-sm font-black hover:bg-white/10 disabled:opacity-50">Dismiss</button>
                </div>
              ) : <p className="mt-4 text-sm text-[#8f889b]">Resolution: {report.resolution?.replaceAll("_", " ") || "Reviewed"}</p>}
            </article>
          ))}
        </div>
      </section>

      <section id="rooms" className="mt-8 rounded-xl border border-white/10 bg-[#100a17] p-5 md:p-7">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div><h2 className="text-2xl font-black">Rooms and live state</h2><p className="mt-1 text-sm text-[#aaa4b8]">Showing up to 15 rooms. Search by title, host, status, or exact room ID.</p></div>
          <form onSubmit={(event) => { event.preventDefault(); void loadDashboard(userSearch, roomSearch); }} className="flex gap-2"><input value={roomSearch} onChange={(event) => setRoomSearch(event.target.value)} className="min-w-0 rounded-md border border-white/15 bg-black/30 px-4 py-3 text-sm outline-none focus:border-purple-400 md:w-80" placeholder="Search rooms" /><button className="rounded-md bg-[#9146ff] px-4 py-3 text-sm font-black hover:bg-[#7b31e8]">Search</button></form>
        </div>
        <p className="mt-3 text-sm text-[#aaa4b8]">Administrative room actions are irreversible and written to the audit log.</p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-[#8f889b]"><tr><th className="pb-3">Room</th><th className="pb-3">Status</th><th className="pb-3">People</th><th className="pb-3">Live signal</th><th className="pb-3">Last active</th><th className="pb-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-white/10">
              {dashboard.rooms.map((room) => (
                <tr key={room.id}>
                  <td className="py-4 pr-4"><Link href={`/room/${room.id}`} className="font-black text-purple-200 hover:text-purple-100">{room.title}</Link><p className="mt-1 text-xs text-[#777180]">{room.host_username || "No host"} · {room.is_private ? "Private" : "Public"}</p></td>
                  <td className="py-4 pr-4"><StatusPill tone={room.status === "ended" ? "neutral" : "good"}>{room.status}</StatusPill></td>
                  <td className="py-4 pr-4 text-[#c9c4d2]">{room.current_users} active · {room.queue_count} queued</td>
                  <td className="py-4 pr-4"><StatusPill tone={room.is_live ? "danger" : "neutral"}>{room.is_live ? `${room.active_publisher_count} publishing` : "Offline"}</StatusPill><p className="mt-1 text-xs text-[#777180]">{room.signal_source || "No signal"}</p></td>
                  <td className="py-4 pr-4 text-[#aaa4b8]">{formatDate(room.last_active_at)}</td>
                  <td className="py-4 text-right">
                    <div className="flex justify-end gap-2">{room.status !== "ended" && <><button disabled={busyAction === `room:${room.id}`} onClick={() => void manageRoom(room, "clear")} className="rounded-md border border-amber-300/25 px-3 py-2 font-black text-amber-100 hover:bg-amber-500/10 disabled:opacity-50">Clear</button><button disabled={busyAction === `room:${room.id}`} onClick={() => void manageRoom(room, "end")} className="rounded-md border border-red-300/30 px-3 py-2 font-black text-red-200 hover:bg-red-500/10 disabled:opacity-50">End</button></>}<button disabled={busyAction === `room:${room.id}`} onClick={() => void deleteRoom(room)} className="rounded-md bg-red-700 px-3 py-2 font-black hover:bg-red-600 disabled:opacity-50">Delete</button></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="users" className="mt-8 rounded-xl border border-white/10 bg-[#100a17] p-5 md:p-7">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div><h2 className="text-2xl font-black">Users</h2><p className="mt-1 text-sm text-[#aaa4b8]">Showing up to 12 users. Search by email, username, or exact user ID.</p></div>
          <form onSubmit={(event) => { event.preventDefault(); void loadDashboard(userSearch, roomSearch); }} className="flex gap-2"><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} className="min-w-0 rounded-md border border-white/15 bg-black/30 px-4 py-3 text-sm outline-none focus:border-purple-400 md:w-80" placeholder="Search users" /><button className="rounded-md bg-[#9146ff] px-4 py-3 text-sm font-black hover:bg-[#7b31e8]">Search</button></form>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {dashboard.users.map((user) => (
            <article key={user.id} className="rounded-lg border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate font-black">{user.username || "PartyUp user"}</p><p className="truncate text-sm text-[#aaa4b8]">{user.email || "No email"}</p></div>{user.admin_role && <StatusPill tone="good">{user.admin_role}</StatusPill>}</div>
              <p className="mt-3 break-all font-mono text-xs text-[#777180]">{user.id}</p>
              <p className="mt-2 text-xs text-[#8f889b]">Joined {formatDate(user.created_at)} · Last sign-in {formatDate(user.last_sign_in_at)}</p>
              <Link href={`/user/${user.id}`} className="mt-3 inline-flex text-sm font-black text-purple-300 hover:text-purple-200">View profile</Link>
            </article>
          ))}
        </div>
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-2">
        <section id="deletions" className="rounded-xl border border-white/10 bg-[#100a17] p-5 md:p-7">
          <h2 className="text-2xl font-black">Account deletion operations</h2>
          <div className="mt-5 grid gap-3">
            {dashboard.deletion_requests.length === 0 && <p className="text-sm text-[#8f889b]">No deletion requests recorded.</p>}
            {dashboard.deletion_requests.map((request) => <article key={request.request_id} className="rounded-lg border border-white/10 bg-black/20 p-4"><div className="flex items-center justify-between gap-3"><span className="font-mono text-xs text-[#aaa4b8]">{request.account_fingerprint}…</span><StatusPill tone={request.status === "failed" ? "danger" : request.status === "completed" ? "good" : "warn"}>{request.status}</StatusPill></div><p className="mt-2 text-xs text-[#777180]">Requested {formatDate(request.requested_at)}</p>{request.last_error && <p className="mt-2 text-sm text-red-200">{request.last_error}</p>}</article>)}
          </div>
        </section>

        <section id="audit" className="rounded-xl border border-white/10 bg-[#100a17] p-5 md:p-7">
          <h2 className="text-2xl font-black">Admin audit log</h2>
          <div className="mt-5 grid max-h-[620px] gap-3 overflow-y-auto pr-1">
            {dashboard.audit_log.length === 0 && <p className="text-sm text-[#8f889b]">No administrative actions recorded yet.</p>}
            {dashboard.audit_log.map((entry) => <article key={entry.id} className="rounded-lg border border-white/10 bg-black/20 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-black text-purple-200">{entry.action.replaceAll("_", " ")}</p><span className="text-xs text-[#777180]">{formatDate(entry.created_at)}</span></div><p className="mt-2 text-sm text-[#c9c4d2]">{entry.reason}</p><p className="mt-2 break-all text-xs text-[#777180]">{entry.admin_email || entry.admin_user_id} · {entry.target_type}{entry.target_id ? ` ${entry.target_id}` : ""}</p></article>)}
          </div>
        </section>
      </div>
    </div>
  );
}
