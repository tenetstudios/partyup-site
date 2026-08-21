import type { Metadata } from "next";
import { InfoPageShell, InfoSection, TextLink } from "@/app/components/InfoPage";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Readable PartyUp terms for live rooms, Match, user content, events, safety, and service use.",
};

export default function TermsPage() {
  return (
    <InfoPageShell
      eyebrow="Terms of Use"
      title="Terms of Use"
      subtitle="Last updated: August 19, 2026"
    >
      <InfoSection title="Acceptance">
        <p>By using PartyUp, you agree to these Terms.</p>
      </InfoSection>

      <InfoSection title="PartyUp Service">
        <p>
          PartyUp provides live social rooms, Match, livestreaming, messaging, event and context participation, Connections, Following, and related social functionality.
        </p>
      </InfoSection>

      <InfoSection title="Eligibility">
        <p>
          You must meet any applicable age requirements for PartyUp and for the jurisdiction where you use the service. PartyUp may restrict features based on safety, age, legal, or operational requirements.
        </p>
      </InfoSection>

      <InfoSection title="User Conduct">
        <p>You may not:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>harass or threaten others</li>
          <li>impersonate another person</li>
          <li>exploit, scam, or deceive others</li>
          <li>violate another person&apos;s privacy</li>
          <li>upload or share unlawful content</li>
          <li>interfere with PartyUp systems</li>
          <li>abuse Match or guest systems</li>
          <li>evade legitimate moderation or access restrictions</li>
          <li>use PartyUp for illegal activity</li>
        </ul>
      </InfoSection>

      <InfoSection title="User Content">
        <p>
          You are responsible for what you post, stream, send, or share through PartyUp. You keep your rights in your content, but give PartyUp the limited permission needed to host, display, transmit, process, and operate that content as part of providing the service.
        </p>
      </InfoSection>

      <InfoSection title="Live And Match Interactions">
        <p>
          PartyUp does not guarantee who you will encounter, that another user&apos;s information is accurate, that a Match will be compatible, or that the service will be uninterrupted.
        </p>
      </InfoSection>

      <InfoSection title="Events And Hosts">
        <p>
          Rooms may be created by independent hosts or organizers. PartyUp does not automatically become the organizer or operator of every physical event, place, or gathering represented on the platform.
        </p>
      </InfoSection>

      <InfoSection title="User Safety">
        <p>
          Review the <TextLink href="/safety">Safety page</TextLink> before using live rooms, Match, or meeting people through PartyUp.
        </p>
      </InfoSection>

      <InfoSection title="Termination And Moderation">
        <p>
          PartyUp may restrict or terminate access when users violate these Terms, create safety risks, abuse systems, evade restrictions, or where necessary to operate the service.
        </p>
      </InfoSection>

      <InfoSection title="Service Changes">
        <p>PartyUp may modify, add, or remove features as the product evolves.</p>
      </InfoSection>

      <InfoSection title="Disclaimers And Liability">
        <p>
          PartyUp is provided as an evolving service. To the extent permitted by applicable law, PartyUp is provided without guarantees that every feature will always be available, error-free, or suitable for every situation.
        </p>
        <p>
          To the extent permitted by applicable law, PartyUp is not responsible for losses that are indirect, unexpected, or outside PartyUp&apos;s reasonable control.
        </p>
      </InfoSection>

      <InfoSection title="Changes To Terms">
        <p>
          These Terms may change as PartyUp evolves. The Last updated date will reflect changes.
        </p>
      </InfoSection>

      <InfoSection title="Contact And Review">
        <p>
          Questions can be sent through the <TextLink href="/contact">Contact page</TextLink>. These MVP Terms should receive formal legal review before broad commercial launch.
        </p>
      </InfoSection>
    </InfoPageShell>
  );
}
