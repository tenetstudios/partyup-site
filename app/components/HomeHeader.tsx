"use client";
import Link from "next/link";
import React, { useEffect, useRef, useState } from "react";
import AuthButton from "@/app/components/AuthButton";
import CreateRoomButton from "@/app/components/CreateRoomButton";
import { resolveMyEventRecaps } from "@/lib/recaps";
import { createSupabaseClient } from "@/lib/supabase";

function NavIcon({ type }: { type: "home" | "map" | "connections" | "activity" }) {
  const paths = {
    home: <path d="M5 21V10.5L12 5l7 5.5V21h-5v-6h-4v6H5Z" />,
    map: <path d="m5 6 5-2 6 2 5-2v16l-5 2-6-2-5 2V6Zm5-2v16m6-14v16" />,
    connections: <path d="M8 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm8 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM10.7 9.8l2.6 4.4" />,
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

export default function HomeHeader({ liveCount }: { liveCount?: number }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const nav = [
    { href: "/", label: "Home", icon: "home" as const, active: true },
    { href: "/map", label: "Map", icon: "map" as const },
    { href: "/connections", label: "Connections", icon: "connections" as const },
    { href: "/activity", label: "Activity", icon: "activity" as const },
  ];

  useEffect(() => {
    const supabase = createSupabaseClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function start() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      try { await resolveMyEventRecaps(supabase); } catch { /* Existing Activity remains usable before migration deployment. */ }
      const refresh = async () => {
        const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", data.user!.id).eq("is_read", false);
        setUnreadCount(count || 0);
      };
      await refresh();
      channel = supabase.channel(`web-notifications-${data.user.id}`).on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${data.user.id}` }, refresh).subscribe();
    }
    void start();
    return () => { if (channel) void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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
              {item.icon === "activity" && unreadCount > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-[#c35dff] px-1.5 text-[10px] font-black text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3 md:gap-5">
          {typeof liveCount === "number" && (
            <div className="hidden h-10 items-center gap-2 rounded-2xl border border-purple-300/20 bg-black/20 px-4 text-[15px] font-black uppercase text-white sm:flex">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff244d] shadow-[0_0_14px_rgba(255,36,77,0.9)]" />
              {liveCount} LIVE
            </div>
          )}

          <AuthButton />

          <CreateRoomButton className="hidden md:inline-block" />

          <div ref={menuRef} className="relative md:hidden">
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((current) => !current)}
              className="grid h-10 w-10 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-white shadow-[0_10px_30px_rgba(0,0,0,0.24)] hover:border-purple-300/40"
            >
              <span aria-hidden="true" className="text-2xl leading-none">☰</span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-12 w-[210px] overflow-hidden rounded-lg border border-purple-300/20 bg-[#10101a] p-2 shadow-2xl shadow-purple-950/40"
              >
                {nav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-black text-[#d6d1df] hover:bg-[#8b3dff]/18 hover:text-white"
                  >
                    <NavIcon type={item.icon} />
                    {item.label}
                    {item.icon === "activity" && unreadCount > 0 && <span className="ml-auto grid min-w-5 place-items-center rounded-full bg-[#c35dff] px-1.5 text-[10px] font-black text-white">{unreadCount > 99 ? "99+" : unreadCount}</span>}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
