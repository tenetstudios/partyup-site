export const ACCOUNT_DELETION_UNAVAILABLE_MESSAGE =
  "Account deletion is being prepared. Please contact PartyUp support to request deletion.";

export type AccountDeletionRequestResult = {
  status: "unavailable";
  message: string;
};

/**
 * Frontend boundary for the future authenticated, server-side deletion request.
 *
 * The eventual implementation must derive the target account from the verified
 * session on the server. It must not accept a user ID from the browser as proof
 * of which account may be deleted.
 */
export async function requestAccountDeletion(): Promise<AccountDeletionRequestResult> {
  return {
    status: "unavailable",
    message: ACCOUNT_DELETION_UNAVAILABLE_MESSAGE,
  };
}
