import type { Metadata } from "next";
import { InfoCtaRow, InfoPageShell, InfoSection, PrimaryCta } from "@/app/components/InfoPage";

export const metadata: Metadata = {
  title: "About PartyUp",
  description: "Learn how PartyUp turns live rooms and shared moments into real social connections.",
};

const features = [
  {
    title: "Rooms",
    body: "Temporary social spaces around live events, places and communities.",
  },
  {
    title: "Match",
    body: "Meet someone experiencing the same thing you are.",
  },
  {
    title: "Live",
    body: "Watch or participate in what is happening in the room.",
  },
  {
    title: "Connections",
    body: "Keep the people you genuinely meet through PartyUp.",
  },
];

export default function AboutPage() {
  return (
    <InfoPageShell eyebrow="PartyUp" title="Live rooms. Real people.">
      <div className="space-y-5 text-lg font-medium leading-8 text-[#d5cede]">
        <p>
          PartyUp is a live social platform built around the things people are experiencing right now.
        </p>
        <p>
          Concerts, nightlife, sports, watch parties, pop-ups, campuses and other events already bring people together. PartyUp creates a temporary digital space around those moments so the people inside the crowd can actually meet one another.
        </p>
        <p>
          Instead of only watching the stage or scrolling through a feed, PartyUp lets you look sideways.
        </p>
        <p>
          Join a room. See what is happening. Match with someone who is there. Talk. And if you both want to keep in touch, stay connected after the moment ends.
        </p>
        <p className="text-xl font-black text-white">
          Events create crowds. PartyUp turns crowds into networks.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {features.map((feature) => (
          <InfoSection key={feature.title} title={feature.title}>
            <p>{feature.body}</p>
          </InfoSection>
        ))}
      </div>

      <InfoCtaRow>
        <PrimaryCta href="/live-now">Explore Live Rooms</PrimaryCta>
        <PrimaryCta href="/match" tone="pink">Start Matching</PrimaryCta>
      </InfoCtaRow>
    </InfoPageShell>
  );
}
