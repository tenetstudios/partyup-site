"use client";
import Link from "next/link";
import React from "react";
import AuthButton from "@/app/components/AuthButton";
import CreateRoomButton from "@/app/components/CreateRoomButton";

function NavIcon({ type }: { type: "home" | "map" | "following" | "activity" }) {
  const paths = {
    home: <path d="M5 21V10.5L12 5l7 5.5V21h-5v-6h-4v6H5Z" />,
    map: <path d="m5 6 5-2 6 2 5-2v16l-5 2-6-2-5 2V6Zm5-2v16m6-14v16" />,
    following: <path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z" />,
    activity: <path d="M7 21V8l5-4 5 4v13H7Zm3-8h4" />,
  } as const;

  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" aria-hidden="true">
      {React.cloneElement(paths[type], {
        stroke: "currentColor",
        strokeWidth: 1.9,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      })}
    </svg>
  );
}

export default function HomeHeader({ liveCount }: { liveCount: number }) {
  const nav = [
    { href: "/", label: "Home", icon: "home" as const, active: true },
    { href: "/map", label: "Map", icon: "map" as const },
    { href: "/following", label: "Following", icon: "following" as const },
    { href: "/activity", label: "Activity", icon: "activity" as const },
  ];

  return (
    <nav className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#070610]/95 backdrop-blur">
      <div className="mx-auto flex h-[76px] w-full max-w-[1458px] items-center justify-between px-5 xl:px-0">
        <Link href="/" className="text-[29px] font-black leading-none tracking-[-0.02em]">
          party<span className="text-[#8b3dff]">up</span>.io
        </Link>

        <div className="hidden items-center gap-11 text-[15px] font-semibold text-[#c6c2cf] md:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 transition hover:text-white ${item.active ? "text-[#9b4dff]" : ""}`}
            >
              <NavIcon type={item.icon} />
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-5">
          <div className="hidden h-10 items-center gap-2 rounded-2xl border border-purple-300/20 bg-black/20 px-4 text-[15px] font-black uppercase text-white sm:flex">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff244d] shadow-[0_0_14px_rgba(255,36,77,0.9)]" />
            {liveCount} LIVE
          </div>

          <AuthButton />

          <CreateRoomButton />
        </div>
      </div>
    </nav>
  );
}
