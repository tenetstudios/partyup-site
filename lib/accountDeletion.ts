import { FunctionsHttpError } from "@supabase/supabase-js";
import { createSupabaseClient } from "@/lib/supabase";

export type AccountDeletionRequestResult = {
  status: "completed" | "reauthentication_required" | "error";
  message: string;
  requestId?: string;
};

export async function requestAccountDeletion(): Promise<AccountDeletionRequestResult> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.functions.invoke("delete-account", {
    body: { confirmed: true },
  });

  if (!error && data?.status === "completed") {
    await supabase.auth.signOut({ scope: "local" });
    return {
      status: "completed",
      message: "Your PartyUp account and associated account data have been deleted.",
      requestId: data.requestId,
    };
  }

  if (error instanceof FunctionsHttpError) {
    const response = await error.context.json().catch(() => null);
    if (response?.code === "reauthentication_required") {
      return {
        status: "reauthentication_required",
        message: response.error,
      };
    }

    return {
      status: "error",
      message: response?.error || "Account deletion could not be completed. Please try again.",
      requestId: response?.requestId,
    };
  }

  return {
    status: "error",
    message: error?.message || "Account deletion could not be completed. Please try again.",
  };
}
