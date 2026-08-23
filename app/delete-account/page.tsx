import type { Metadata } from "next";
import DeleteAccountFlow from "@/app/delete-account/DeleteAccountFlow";
import { InfoPageShell, InfoSection, TextLink } from "@/app/components/InfoPage";

export const metadata: Metadata = {
  title: "Delete Account",
  description: "Request deletion of your PartyUp account and associated data.",
};

export default function DeleteAccountPage() {
  return (
    <InfoPageShell
      eyebrow="PartyUp account"
      title="Delete your PartyUp account"
      subtitle="Use this page to understand what account deletion covers and begin a deletion request. These instructions are public and do not require a PartyUp sign-in."
    >
      <InfoSection title="What account deletion covers">
        <p>
          Deleting a PartyUp account removes or disassociates the account and profile,
          contact and sign-in information, follows and connections, notifications, room
          participation and messages, Match history, and Memories or uploads tied to that account.
        </p>
        <p>
          Some information may be retained where legally required or where reasonably needed for
          security, fraud prevention, dispute resolution, enforcing our terms, or service
          operations. Shared content may also need to be anonymized rather than removed when it is
          necessary to preserve other users&apos; records or the integrity of an event.
        </p>
      </InfoSection>

      <InfoSection title="Request account deletion">
        <DeleteAccountFlow />
      </InfoSection>

      <InfoSection title="Need help?">
        <p>
          If you cannot access your account or need help with a deletion request, use the PartyUp
          <TextLink href="/contact">Contact page</TextLink>. Include the email address associated
          with your account, but do not send your password or sign-in codes.
        </p>
      </InfoSection>
    </InfoPageShell>
  );
}
