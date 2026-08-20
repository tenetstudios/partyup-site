import Link from "next/link";
import Image from "next/image";
import React from "react";
import { LiveRoom } from "@/lib/homeHelpers";

function RoomVisual({ rooms }: { rooms: LiveRoom[] }) {
  const image = rooms.find((room) => room.cover_image)?.cover_image;

  return (
    <div className="pointer-events-none absolute right-0 top-0 hidden h-[432px] w-[53%] overflow-hidden lg:block">
      {image ? (
        <div
          className="absolute inset-0 bg-cover bg-center opacity-80"
          style={{ backgroundImage: `url(${image})` }}
        />
      ) : (
        <div className="absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_68%_15%,rgba(246,61,157,0.5),transparent_9%),radial-gradient(circle_at_56%_30%,rgba(178,100,255,0.58),transparent_8%),radial-gradient(circle_at_76%_25%,rgba(139,61,255,0.72),transparent_18%),linear-gradient(135deg,#1a0828,#080610_70%)]">
          <div className="absolute left-[34%] top-[11%] h-[420px] w-[18px] rotate-[18deg] bg-fuchsia-400/35 blur-md" />
          <div className="absolute left-[55%] top-[2%] h-[470px] w-[22px] rotate-[31deg] bg-violet-400/40 blur-md" />
          <div className="absolute left-[73%] top-[7%] h-[430px] w-[18px] rotate-[-22deg] bg-purple-500/35 blur-md" />
          <Image
            src="/assets/peace-sign-arm.png"
            alt=""
            aria-hidden="true"
            width={1024}
            height={1536}
            priority
            className="pointer-events-none absolute bottom-[-31%] right-[4%] h-[126%] w-auto select-none object-contain opacity-90"
          />
        </div>
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,#05040b_0%,rgba(5,4,11,0.84)_14%,rgba(5,4,11,0.26)_43%,rgba(5,4,11,0.1)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,4,11,0)_0%,rgba(5,4,11,0.2)_58%,#05040b_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_58%_18%,rgba(139,61,255,0.34),transparent_34%),radial-gradient(circle_at_76%_22%,rgba(255,45,154,0.18),transparent_24%)]" />
    </div>
  );
}

function ExploreIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12 text-[#9b4dff]" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="19" stroke="currentColor" strokeWidth="3" />
      <path d="M7 24h34M24 5c6 6 9 12 9 19s-3 13-9 19M24 5c-6 6-9 12-9 19s3 13 9 19" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
      <path d="m29 31 11 8" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
    </svg>
  );
}

function MatchIcon() {
  return (
    <svg viewBox="0 0 54 48" className="h-12 w-14 text-[#ff3a9d]" fill="none" aria-hidden="true">
      <circle cx="20" cy="21" r="13" stroke="currentColor" strokeWidth="3" />
      <circle cx="35" cy="22" r="13" stroke="currentColor" strokeWidth="3" />
      <path d="m11 31-5 10 12-5M42 32l6 9-13-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
      <path d="M15 19h.1M25 19h.1M18 26c2 2 5 2 7 0M31 20h.1M40 20h.1M33 27c2 2 5 2 7 0" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
    </svg>
  );
}

function HeroActionCard({
  href,
  title,
  body,
  cta,
  tone,
  icon,
}: {
  href: string;
  title: string;
  body: string;
  cta: string;
  tone: "purple" | "pink";
  icon: React.ReactNode;
}) {
  const isPink = tone === "pink";

  return (
    <article className={`flex min-h-[193px] flex-col rounded-[10px] border p-6 ${isPink ? "border-pink-500/35 bg-[radial-gradient(circle_at_82%_16%,rgba(255,45,154,0.2),transparent_42%),linear-gradient(135deg,rgba(68,10,52,0.9),rgba(27,8,31,0.82))]" : "border-purple-400/35 bg-[radial-gradient(circle_at_18%_14%,rgba(139,61,255,0.25),transparent_42%),linear-gradient(135deg,rgba(34,15,72,0.86),rgba(17,10,34,0.88))]"}`}>
      <div className="flex items-start gap-4">
        <div className="-ml-1 shrink-0">{icon}</div>
        <div className="min-w-0">
          <h2 className={`text-[24px] font-black leading-tight ${isPink ? "text-[#ff68b4]" : "text-[#c79aff]"}`}>{title}</h2>
          <p className="mt-3 max-w-[220px] text-[16px] leading-[1.45] text-[#cbc6d6]">{body}</p>
        </div>
      </div>
      <Link
        href={href}
        className={`mt-auto grid h-10 place-items-center rounded-md text-[15px] font-black text-white shadow-lg transition hover:brightness-110 ${isPink ? "bg-[#f02c91] shadow-pink-950/30" : "bg-[#8b3dff] shadow-purple-950/30"}`}
      >
        {cta}
      </Link>
    </article>
  );
}

export default function HomeHero({ rooms }: { rooms: LiveRoom[] }) {
  return (
    <section className="relative min-h-[474px] overflow-hidden pt-5">
      <RoomVisual rooms={rooms} />
      <div className="relative z-10 max-w-[704px]">
        <h1 className="text-[54px] font-black leading-[0.92] tracking-normal text-white sm:text-[66px] lg:text-[72px]">
          Live rooms.
          <span className="block bg-gradient-to-r from-[#8b3dff] via-[#b44dff] to-[#ff3d9f] bg-clip-text text-transparent">
            Real people.
          </span>
        </h1>
        <p className="mt-5 text-[20px] leading-[1.35] text-[#c9c4d4]">
          Discover what&apos;s happening around you.
          <br />
          Or meet someone new.
        </p>

        <div className="mt-6 grid max-w-[684px] gap-5 sm:grid-cols-2">
          <HeroActionCard href="/map" title="Explore Rooms" body="See what's live around you and join the vibe." cta="Explore Map" tone="purple" icon={<ExploreIcon />} />
          <HeroActionCard href="/match" title="Match" body="Meet a random person for a 1-on-1 video chat." cta="Start Matching" tone="pink" icon={<MatchIcon />} />
        </div>
      </div>
    </section>
  );
}
