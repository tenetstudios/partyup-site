import type { Metadata } from "next";
import { InfoPageShell, InfoSection, TextLink } from "@/app/components/InfoPage";

export const metadata: Metadata = {
  title: "Safety",
  description: "PartyUp safety guidance for rooms, Match, guest access, and meeting people through shared experiences.",
};

export default function SafetyPage() {
  return (
    <InfoPageShell
      eyebrow="PartyUp Safety"
      title="Safety"
      subtitle="PartyUp is designed to help people meet through shared experiences. That only works when people feel comfortable using it."
    >
      <InfoSection title="Respect People">
        <p>Do not:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>harass or threaten people</li>
          <li>use hateful or discriminatory language</li>
          <li>impersonate others</li>
          <li>pressure someone to share personal information</li>
          <li>share someone else&apos;s private information</li>
          <li>use PartyUp to exploit, scam, or deceive others</li>
        </ul>
      </InfoSection>

      <InfoSection title="Match Safety">
        <p>
          You can move on from a Match at any time. Keep in Touch is mutual, and one person&apos;s choice should not be revealed unless the relationship becomes mutual.
        </p>
        <p>
          No one should feel obligated to continue a conversation, share contact details, or meet again.
        </p>
      </InfoSection>

      <InfoSection title="Meeting Offline">
        <p>
          Meeting someone through PartyUp does not mean they are personally known or verified. If you choose to meet someone, prefer public or event spaces, tell a trusted person where you are when appropriate, and trust your judgment.
        </p>
        <p>Leave any interaction that feels unsafe.</p>
      </InfoSection>

      <InfoSection title="Personal Information">
        <p>Avoid unnecessarily sharing sensitive information, including:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>home address</li>
          <li>passwords</li>
          <li>financial information</li>
          <li>private credentials</li>
          <li>highly sensitive personal information</li>
        </ul>
      </InfoSection>

      <InfoSection title="Reporting And Moderation">
        <p>
          Signed-in users can report room messages for harassment, hate, sexual content, threats, scams, personal-information exposure, or another safety concern. Reports send an evidence snapshot and optional context to the room host for review.
        </p>
        <p>
          Hosts can dismiss a report, remove the reported message, or temporarily mute the reported account. Reports do not automatically remove content or notify the reported person.
        </p>
        <p>
          PartyUp may retain report evidence and account, guest, session, and room activity identifiers to operate the service, review moderation decisions, and help prevent abuse.
        </p>
      </InfoSection>

      <InfoSection title="Emergencies">
        <p className="font-black text-white">PartyUp is not an emergency service.</p>
        <p>
          If someone faces immediate danger, contact local emergency services or seek help from venue staff or security.
        </p>
        <p>
          See also the <TextLink href="/terms">Terms of Use</TextLink>.
        </p>
      </InfoSection>
    </InfoPageShell>
  );
}
