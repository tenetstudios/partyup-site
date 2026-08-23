import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import HomeFooter from "@/app/components/HomeFooter";
import HomeHeader from "@/app/components/HomeHeader";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";

export const metadata: Metadata = {
  title: "About PartyUp",
  description:
    "PartyUp creates temporary digital spaces around live events, places and shared experiences so people can meet, participate, remember and stay connected.",
};

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-black uppercase text-[#d56cff] sm:text-sm">
      {children}
    </p>
  );
}

function Chapter({
  eyebrow,
  title,
  children,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`border-t border-purple-100/15 py-16 sm:py-20 lg:py-24 ${className}`}
    >
      <div className="max-w-3xl">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className="mt-3 text-3xl font-black leading-tight text-white sm:text-4xl lg:text-5xl">
          {title}
        </h2>
        <div className="mt-7 space-y-5 text-base font-medium leading-8 text-[#c9c2d7] sm:text-lg">
          {children}
        </div>
      </div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <PartyUpPageShell intensity="standard" crowd>
      <HomeHeader />

      <article className="relative mx-auto w-full max-w-[1180px] px-5 sm:px-7 lg:px-10">
        <header className="flex min-h-[calc(100svh-10rem)] max-w-4xl flex-col justify-center pb-8 pt-14 sm:min-h-[680px] sm:py-20">
          <Eyebrow>PartyUp</Eyebrow>
          <h1 className="mt-4 text-5xl font-black leading-none text-white sm:text-6xl lg:text-7xl">
            Be part of it.
          </h1>
          <div className="mt-8 max-w-3xl space-y-5 text-base font-medium leading-8 text-[#d5cede] sm:text-lg">
            <p className="text-xl font-bold leading-8 text-white sm:text-2xl sm:leading-9">
              PartyUp creates temporary digital spaces around the things happening in the real world.
            </p>
            <p>
              A nightclub. A concert. A game. A campus. A festival. A watch party. A crowd gathered around the same thing, in the same place, at the same time.
            </p>
            <div className="border-l-2 border-[#c35dff]/70 pl-5 text-white">
              <p>Most platforms ask you to look somewhere else.</p>
              <p className="mt-2 font-black">PartyUp asks you to look around.</p>
            </div>
            <p>
              Enter the room for what you&apos;re experiencing. See who&apos;s there. Meet someone in the crowd. Take part in what the host is doing. Capture the moments people are creating around you.
            </p>
            <p>And when the event ends, keep the parts that mattered.</p>
          </div>
        </header>

        <Chapter
          title="The room exists because the moment does."
          className="!pt-8 sm:!pt-12 lg:!pt-16"
        >
          <p>PartyUp Rooms are temporary digital spaces attached to real-world contexts.</p>
          <p>
            Scan a QR at a venue, enter an event online, or discover something happening around you.
          </p>
          <p>While you&apos;re there, the room becomes a digital layer around the experience.</p>
          <p className="font-black text-white">
            The event ends. The room doesn&apos;t need to last forever.
          </p>
          <p>That temporariness is part of the point.</p>
        </Chapter>

        <section className="grid gap-10 border-t border-purple-100/15 py-16 sm:py-20 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center lg:gap-20 lg:py-24">
          <div className="max-w-3xl">
            <Eyebrow>Match</Eyebrow>
            <h2 className="mt-3 text-3xl font-black leading-tight text-white sm:text-4xl lg:text-5xl">
              Look sideways.
            </h2>
            <div className="mt-7 space-y-5 text-base font-medium leading-8 text-[#c9c2d7] sm:text-lg">
              <p>
                There may be hundreds or thousands of people around you who you would never otherwise meet.
              </p>
              <p>PartyUp Match introduces you to someone sharing the same context.</p>
              <p className="text-2xl font-black text-white">Talk.</p>
              <p>If you want to meet somebody else, press Next.</p>
              <p>If you both decide you want to stay in touch, you become Connections.</p>
              <p className="font-black text-white">No friend request. No one-sided reveal.</p>
              <p className="font-black text-white">Both people choose.</p>
            </div>
          </div>

          <div aria-hidden="true" className="relative mx-auto h-56 w-full max-w-[340px]">
            <div className="absolute left-3 top-5 h-40 w-40 rounded-full border border-purple-200/30 bg-[#431a7d]/30 shadow-[0_0_55px_rgba(139,61,255,0.28)] backdrop-blur-md" />
            <div className="absolute right-3 top-5 h-40 w-40 rounded-full border border-pink-200/30 bg-[#7d164c]/25 shadow-[0_0_55px_rgba(236,41,148,0.25)] backdrop-blur-md" />
            <div className="absolute inset-x-0 bottom-2 mx-auto h-px w-32 bg-[linear-gradient(90deg,transparent,#d56cff,transparent)]" />
          </div>
        </section>

        <section className="border-t border-purple-100/15 py-16 sm:py-20 lg:py-24">
          <div className={`${partyUpTheme.glassElevated} grid gap-9 p-6 sm:p-9 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center lg:p-12`}>
            <div className="max-w-3xl">
              <Eyebrow>Missions</Eyebrow>
              <h2 className="mt-3 text-3xl font-black leading-tight text-white sm:text-4xl">
                Don&apos;t just watch the crowd. Join it.
              </h2>
              <div className="mt-7 space-y-5 text-base font-medium leading-8 text-[#c9c2d7] sm:text-lg">
                <p>Hosts can give the room things to do together.</p>
                <p>
                  Meet someone new. Find your group. Complete a challenge. Participate in something happening across the venue.
                </p>
                <p>Missions use the digital room to create interaction in the physical world.</p>
                <p className="font-black text-white">The phone is the starting point—not the destination.</p>
              </div>
            </div>

            <div aria-hidden="true" className="rounded-lg border border-purple-200/20 bg-[#130d2b]/70 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <p className="text-xs font-black uppercase text-[#d56cff]">Mission</p>
              <div className="mt-5 space-y-3">
                <div className="h-2 w-4/5 rounded-full bg-white/15" />
                <div className="h-2 w-3/5 rounded-full bg-white/10" />
              </div>
              <div className="mt-7 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-2/3 rounded-full bg-[linear-gradient(90deg,#8b3dff,#ec2994)]" />
              </div>
            </div>
          </div>
        </section>

        <Chapter eyebrow="Memories" title="Capture the night together.">
          <p>
            Every room can become a shared collection of photos and clips created by the people who were actually there.
          </p>
          <p>See the event through other people&apos;s eyes.</p>
          <p>Save the moments you want to remember to your own Memories.</p>
          <p className="font-black text-white">The crowd doesn&apos;t just consume the event.</p>
          <p className="font-black text-white">It leaves something behind.</p>
        </Chapter>

        <section className="border-t border-purple-100/15 py-16 sm:py-20 lg:py-24">
          <h2 className="max-w-3xl text-3xl font-black leading-tight text-white sm:text-4xl lg:text-5xl">
            Some things should survive the room.
          </h2>

          <div className="mt-10 grid gap-0 md:grid-cols-3">
            <div className="border-b border-purple-100/15 py-7 md:border-b-0 md:border-r md:py-2 md:pr-8">
              <Eyebrow>Connections</Eyebrow>
              <div className="mt-5 space-y-3 text-base font-medium leading-7 text-[#c9c2d7]">
                <p>The room is temporary.</p>
                <p>The people don&apos;t have to be.</p>
                <p>People you mutually choose to Keep in Touch with become permanent PartyUp Connections.</p>
              </div>
            </div>

            <div className="border-b border-purple-100/15 py-7 md:border-b-0 md:border-r md:px-8 md:py-2">
              <Eyebrow>My Memories</Eyebrow>
              <p className="mt-5 text-base font-medium leading-7 text-[#c9c2d7]">
                Save moments from the rooms you&apos;ve been part of and build a personal history of experiences.
              </p>
            </div>

            <div className="py-7 md:py-2 md:pl-8">
              <Eyebrow>After the Event</Eyebrow>
              <p className="mt-5 text-base font-medium leading-7 text-[#c9c2d7]">
                When the room ends, PartyUp can bring you back to what happened: Memories from the crowd, people you kept, and a recap of the event.
              </p>
            </div>
          </div>

          <p className="mt-10 border-l-2 border-[#ec2994]/70 pl-5 text-xl font-black leading-8 text-white sm:text-2xl">
            The context disappears. What mattered can remain.
          </p>
        </section>

        <section className="border-t border-purple-100/15 py-16 sm:py-20 lg:py-24">
          <div className={`${partyUpTheme.glassCard} p-6 sm:p-9 lg:p-12`}>
            <h2 className="max-w-3xl text-3xl font-black leading-tight text-white sm:text-4xl lg:text-5xl">
              For the people who make things happen.
            </h2>
            <div className="mt-7 max-w-4xl space-y-5 text-base font-medium leading-8 text-[#c9c2d7] sm:text-lg">
              <p>PartyUp isn&apos;t only for the crowd.</p>
              <p>
                Promoters, venues, organizers and creators can build rooms around their events, bring audiences into them through QR codes, communicate with the crowd, launch Missions, manage the room, see what happened, and build a following over time.
              </p>
              <p>Each event contributes to a host&apos;s history.</p>
              <p>Each successful event can make the next one easier to reach.</p>
              <p className="font-black text-white">Hosts don&apos;t have to start from zero every night.</p>
            </div>
          </div>
        </section>

        <section className="border-t border-purple-100/15 py-20 text-center sm:py-24 lg:py-32">
          <p className="text-4xl font-black leading-tight text-white sm:text-5xl lg:text-6xl">
            Events create crowds.
          </p>
          <p className="mt-3 text-4xl font-black leading-tight text-white sm:text-5xl lg:text-6xl">
            PartyUp turns crowds into networks.
          </p>
          <p className="mx-auto mt-7 max-w-xl text-lg font-bold leading-8 text-[#c9c2d7]">
            See what&apos;s happening around you. Be part of it.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/map" className={`${partyUpTheme.primaryButton} w-full px-6 text-sm sm:w-auto`}>
              Explore Rooms
            </Link>
            <Link href="/match" className={`${partyUpTheme.ghostButton} min-h-11 w-full px-6 text-sm sm:w-auto`}>
              Find a Match
            </Link>
          </div>
        </section>
      </article>

      <HomeFooter />
    </PartyUpPageShell>
  );
}
