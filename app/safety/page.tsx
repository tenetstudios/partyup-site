import type { Metadata } from "next";
import { InfoPageShell, InfoSection, TextLink } from "@/app/components/InfoPage";

export const metadata: Metadata = {
  title: "Safety and Child Safety Standards",
  description: "PartyUp safety standards, including our standards against child sexual abuse and exploitation (CSAE) and child sexual abuse material (CSAM).",
};

export default function SafetyPage() {
  return (
    <InfoPageShell
      eyebrow="PartyUp Safety"
      title="Safety and Child Safety Standards"
      subtitle="Last updated: August 24, 2026"
    >
      <InfoSection id="overview" title="PartyUp's Safety Commitment">
        <p>
          PartyUp is designed to help people meet through shared experiences. That only works when people feel safe and respected. These standards apply across PartyUp rooms, Match, messaging, livestreams, profiles, Missions, Memories, and other user-generated content or interactions.
        </p>
        <p>
          PartyUp has zero tolerance for child sexual abuse and exploitation (CSAE) and child sexual abuse material (CSAM). We prohibit using PartyUp to create, upload, solicit, distribute, promote, store, or facilitate content or conduct that sexually exploits, abuses, or endangers a child.
        </p>
      </InfoSection>

      <InfoSection id="child-safety" title="Standards Against Child Sexual Abuse and Exploitation">
        <p>PartyUp strictly prohibits:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>child sexual abuse material, including real, altered, computer-generated, or otherwise synthetic depictions</li>
          <li>grooming, sexual solicitation, or sexualized communication involving a child</li>
          <li>sextortion or threats involving a child&apos;s sexual images or information</li>
          <li>child sex trafficking or arranging, promoting, or facilitating the sexual exploitation of a child</li>
          <li>attempts to obtain, trade, sell, link to, normalize, or encourage CSAE or CSAM</li>
          <li>content or behavior that otherwise sexually exploits, abuses, or endangers a child</li>
        </ul>
        <p>
          These prohibitions apply regardless of whether the conduct is public or private, whether money or another benefit is exchanged, and whether imagery is real or generated.
        </p>
      </InfoSection>

      <InfoSection id="reporting" title="How To Report A Child Safety Concern">
        <p>
          Use PartyUp&apos;s in-app reporting tools to report concerning content or behavior. For a room message, open its actions, choose <strong>Report message</strong>, select <strong>Sexual content</strong> or <strong>Something else</strong>, and include relevant context. The report preserves an evidence snapshot for review.
        </p>
        <p>
          Do not download, copy, forward, or redistribute suspected CSAM in order to report it. Report the content where it appears and preserve only non-content details that may help identify the account, room, or incident.
        </p>
        <p>
          If a child is in immediate danger, contact local emergency services or the appropriate law-enforcement authority. In the United States, suspected child sexual exploitation can also be reported to the National Center for Missing &amp; Exploited Children&apos;s CyberTipline at <TextLink href="https://report.cybertip.org/">report.cybertip.org</TextLink>.
        </p>
      </InfoSection>

      <InfoSection id="response" title="PartyUp's Response And Enforcement">
        <p>
          PartyUp reviews child-safety reports and may remove content, restrict features, suspend or terminate accounts or guest access, preserve relevant evidence, and take other protective action consistent with these standards.
        </p>
        <p>
          When PartyUp becomes aware of apparent CSAM or child sexual exploitation, we act in accordance with applicable law, including legally required reports to the appropriate child-safety organization or law-enforcement authority. PartyUp responds to valid legal requests and may preserve or disclose relevant information where required by law.
        </p>
        <p>
          Retaliation against a person who raises a good-faith safety concern, interference with a report, or attempts to evade a child-safety restriction are prohibited.
        </p>
      </InfoSection>

      <InfoSection id="general-conduct" title="Respect People">
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

      <InfoSection id="match-safety" title="Match Safety">
        <p>
          You can move on from a Match at any time. Keep in Touch is mutual, and one person&apos;s choice should not be revealed unless the relationship becomes mutual.
        </p>
        <p>
          No one should feel obligated to continue a conversation, share contact details, or meet again.
        </p>
      </InfoSection>

      <InfoSection id="offline-safety" title="Meeting Offline">
        <p>
          Meeting someone through PartyUp does not mean they are personally known or verified. If you choose to meet someone, prefer public or event spaces, tell a trusted person where you are when appropriate, and trust your judgment.
        </p>
        <p>Leave any interaction that feels unsafe.</p>
      </InfoSection>

      <InfoSection id="personal-information" title="Personal Information">
        <p>Avoid unnecessarily sharing sensitive information, including:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>home address</li>
          <li>passwords</li>
          <li>financial information</li>
          <li>private credentials</li>
          <li>highly sensitive personal information</li>
        </ul>
      </InfoSection>

      <InfoSection id="moderation" title="Reporting And Moderation">
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

      <InfoSection id="emergencies" title="Emergencies">
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
