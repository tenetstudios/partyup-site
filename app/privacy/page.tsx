import type { Metadata } from "next";
import { InfoPageShell, InfoSection, TextLink } from "@/app/components/InfoPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "PartyUp privacy policy for accounts, rooms, Match, Connections, guest sessions, and product operations.",
};

export default function PrivacyPage() {
  return (
    <InfoPageShell
      eyebrow="Privacy Policy"
      title="Privacy Policy"
      subtitle="Last updated: August 19, 2026"
    >
      <InfoSection title="What PartyUp May Collect">
        <p>Based on the current implementation, PartyUp may process:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>account information and Google authentication information</li>
          <li>username, avatar, and profile information</li>
          <li>guest and session identifiers used for guest Match access</li>
          <li>room creation, participation, presence, queue, host, and attendee information</li>
          <li>room messages, announcements, livestream, and other user-generated content</li>
          <li>Match sessions, Match queue activity, Keep in Touch choices, and mutual Connections</li>
          <li>Following and follower relationships</li>
          <li>room/event location fields such as venue name, latitude, and longitude when provided for location-based rooms</li>
          <li>room analytics events and technical/session information needed to operate the service</li>
        </ul>
      </InfoSection>

      <InfoSection title="How PartyUp Uses Information">
        <p>PartyUp uses information to operate live rooms, Match, livestreaming, messaging, guest access, Connections, Following, room presence, host tools, and account/session state.</p>
        <p>PartyUp also uses information to support safety, moderation, reliability, product debugging, and usage understanding where analytics are implemented.</p>
      </InfoSection>

      <InfoSection title="Third-Party Services">
        <p>
          The current web implementation uses Supabase for database, authentication, storage, realtime, and serverless functions; LiveKit for live audio/video room connectivity; Google authentication for sign-in; and Next.js font loading that fetches Google-hosted font resources at build/runtime depending on environment.
        </p>
        <p>
          PartyUp does not control those providers&apos; independent privacy practices. If PartyUp is deployed on an external hosting provider, that provider may also process technical information needed to serve the site.
        </p>
      </InfoSection>

      <InfoSection title="Guest Users">
        <p>
          PartyUp may create an anonymous or pseudonymous session identity so a guest can use certain features. Where supported, a guest can later sign in and associate relevant PartyUp history, including eligible Match and Connection history, with an account.
        </p>
      </InfoSection>

      <InfoSection title="Connections">
        <p>
          Mutual Keep in Touch can create a persistent PartyUp Connection. The product includes functionality to remove Connections.
        </p>
      </InfoSection>

      <InfoSection title="Rooms And User Content">
        <p>
          Room content, messages, livestream participation, profile information, and room activity may be visible to other people in the relevant room or social context according to how each feature works.
        </p>
      </InfoSection>

      <InfoSection title="Retention">
        <p>
          Retention depends on operational, product, safety, and legal needs. The current code does not define a single fixed retention period for all PartyUp data.
        </p>
      </InfoSection>

      <InfoSection title="Security">
        <p>
          PartyUp uses reasonable safeguards for the current product, including backend access controls and session-based authentication patterns, but no internet service can guarantee absolute security.
        </p>
      </InfoSection>

      <InfoSection title="User Choices">
        <p>
          Current choices include signing in or out, using guest Match where available, following or unfollowing profiles, removing Connections, leaving rooms, and managing rooms when you are the host.
        </p>
        <p>
          For privacy questions, use the <TextLink href="/contact">Contact page</TextLink>.
        </p>
      </InfoSection>

      <InfoSection title="Legal Review">
        <p>
          This is an MVP privacy policy drafted from the current implementation and should receive formal legal review before broad commercial launch.
        </p>
      </InfoSection>
    </InfoPageShell>
  );
}
