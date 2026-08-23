import type { SupabaseClient } from "@supabase/supabase-js";

export const chatReportReasons = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate or discrimination" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "threats", label: "Threats or violence" },
  { value: "spam_scam", label: "Spam or scam" },
  { value: "personal_information", label: "Sharing personal information" },
  { value: "other", label: "Something else" },
] as const;

export type ChatReportReason = (typeof chatReportReasons)[number]["value"];
export type ChatReportStatus = "open" | "resolved" | "dismissed";
export type ChatReportReviewAction = "dismiss" | "remove_message" | "mute_5m";

export type RoomMessageReport = {
  id: string;
  message_id: string;
  reported_user_id: string | null;
  reason: ChatReportReason;
  details: string | null;
  message_snapshot: string;
  display_name_snapshot: string | null;
  message_created_at: string;
  status: ChatReportStatus;
  resolution: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export function chatReportReasonLabel(reason: ChatReportReason) {
  return chatReportReasons.find((option) => option.value === reason)?.label ?? "Other";
}

export async function submitRoomMessageReport(
  supabase: SupabaseClient,
  messageId: string,
  reason: ChatReportReason,
  details: string,
) {
  const { data, error } = await supabase.rpc("submit_room_message_report", {
    p_message_id: messageId,
    p_reason: reason,
    p_details: details.trim() || null,
  });

  if (error) throw new Error(error.message);
  return data as { id: string; status: "open"; message_id: string };
}

export async function getRoomMessageReports(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase.rpc("get_room_message_reports", {
    p_room_id: roomId,
  });

  if (error) throw new Error(error.message);
  return (data ?? []) as RoomMessageReport[];
}

export async function getMyRoomMessageReportIds(supabase: SupabaseClient, roomId: string) {
  const { data, error } = await supabase.rpc("get_my_room_message_report_ids", {
    p_room_id: roomId,
  });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row: { message_id: string }) => row.message_id);
}

export async function reviewRoomMessageReport(
  supabase: SupabaseClient,
  reportId: string,
  action: ChatReportReviewAction,
) {
  const { data, error } = await supabase.rpc("review_room_message_report", {
    p_report_id: reportId,
    p_action: action,
  });

  if (error) throw new Error(error.message);
  return data as { id: string; status: ChatReportStatus; resolution: string };
}
