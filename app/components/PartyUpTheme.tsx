import type { ReactNode } from "react";

export type PartyUpAtmosphereIntensity = "subtle" | "standard" | "immersive";

const atmosphereClasses: Record<PartyUpAtmosphereIntensity, {
  crowd: string;
  purple: string;
  pink: string;
}> = {
  subtle: {
    crowd: "opacity-[0.06] sm:opacity-[0.08]",
    purple: "opacity-35 sm:opacity-45",
    pink: "opacity-25 sm:opacity-35",
  },
  standard: {
    crowd: "opacity-[0.07] sm:opacity-10 lg:opacity-[0.13]",
    purple: "opacity-60 sm:opacity-75",
    pink: "opacity-50 sm:opacity-65",
  },
  immersive: {
    crowd: "opacity-30 sm:opacity-36 lg:opacity-42",
    purple: "opacity-100",
    pink: "opacity-100",
  },
};

export const partyUpTheme = {
  glassCard: "rounded-lg border border-purple-200/20 bg-[linear-gradient(135deg,var(--partyup-surface),var(--partyup-surface-deep))] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_14px_38px_rgba(3,2,15,0.2)] backdrop-blur-xl",
  glassInteractive: "rounded-lg border border-purple-200/20 bg-[linear-gradient(135deg,var(--partyup-surface),var(--partyup-surface-deep))] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_14px_38px_rgba(3,2,15,0.2)] backdrop-blur-xl transition duration-200 hover:-translate-y-px hover:border-purple-300/40 hover:brightness-110 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_18px_44px_rgba(58,17,110,0.24)]",
  glassElevated: "rounded-lg border border-purple-200/20 bg-[linear-gradient(145deg,rgba(37,24,65,0.68),rgba(19,14,42,0.72))] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_18px_50px_rgba(0,0,0,0.2)] backdrop-blur-xl",
  primaryButton: "inline-flex min-h-11 items-center justify-center rounded-md border border-fuchsia-300/30 bg-[linear-gradient(110deg,#7c3aed,var(--partyup-pink))] font-black text-white shadow-[0_14px_38px_rgba(190,35,220,0.3)] transition hover:border-fuchsia-200/50 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c35dff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#100b27] disabled:cursor-not-allowed disabled:opacity-60",
  ghostButton: "inline-flex min-h-10 items-center justify-center rounded-md border border-purple-100/15 bg-[#17112e]/55 font-black text-[#d6d1df] backdrop-blur-md transition hover:border-purple-300/35 hover:bg-[#1b1435]/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b3dff]/70 disabled:cursor-not-allowed disabled:opacity-60",
  destructiveButton: "inline-flex min-h-10 items-center justify-center rounded-md border border-pink-400/30 bg-pink-950/10 font-black text-[#ff9dc5] transition hover:border-pink-300/50 hover:bg-pink-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-400/60 disabled:cursor-not-allowed disabled:opacity-60",
  tabBase: "inline-flex min-h-11 min-w-0 items-center justify-center rounded-md border font-black transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b3dff]/70",
  tabActive: "border-[#b968ff]/85 bg-[linear-gradient(135deg,rgba(118,46,255,0.56),rgba(207,48,219,0.24))] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_0_26px_rgba(139,61,255,0.24)]",
  tabInactive: "border-purple-100/15 bg-[#17112e]/55 text-[#aaa4b8] backdrop-blur-md hover:border-purple-300/35 hover:bg-[#1b1435]/70 hover:text-white",
  input: "rounded-md border border-purple-200/20 bg-[#17112d]/60 font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_14px_34px_rgba(0,0,0,0.12)] outline-none backdrop-blur-md transition placeholder:text-[#aaa3b7] focus:border-[#b968ff]/85 focus:bg-[#1a1233]/72 focus:shadow-[0_0_0_3px_rgba(139,61,255,0.15),0_14px_34px_rgba(0,0,0,0.12)]",
  emptyState: "rounded-lg border border-dashed border-purple-300/25 bg-[#100b20]/60 text-center backdrop-blur-md",
  sectionLabel: "text-xs font-black uppercase tracking-[0.16em] text-[#c35dff]",
  textSecondary: "text-[#c9c2d7]",
  textMuted: "text-[#817b8b]",
} as const;

export function PartyUpAtmosphere({
  intensity = "standard",
  crowd = true,
}: {
  intensity?: PartyUpAtmosphereIntensity;
  crowd?: boolean;
}) {
  const classes = atmosphereClasses[intensity];

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(155deg,var(--partyup-bg-deep)_0%,var(--partyup-bg-indigo)_42%,var(--partyup-bg-violet)_100%)]" />
      {crowd && (
        <div
          className={`absolute inset-x-0 top-0 h-[min(960px,100svh)] bg-cover bg-[position:62%_top] mix-blend-screen lg:bg-center ${classes.crowd}`}
          style={{ backgroundImage: "url('/images/partyup-atmosphere-crowd.png')" }}
        />
      )}
      <div className={`absolute inset-0 bg-[radial-gradient(ellipse_62%_80%_at_0%_44%,var(--partyup-glow-purple),transparent_72%)] ${classes.purple}`} />
      <div className={`absolute inset-0 bg-[radial-gradient(ellipse_58%_72%_at_100%_48%,var(--partyup-glow-pink),transparent_70%)] ${classes.pink}`} />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,18,0.18),rgba(10,8,27,0.68)_42%,rgba(12,7,27,0.42)_70%,rgba(17,5,27,0.12))]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_34%,rgba(4,4,14,0.44)_100%)]" />
    </div>
  );
}

export function PartyUpPageShell({
  children,
  intensity = "standard",
  crowd = true,
  className = "",
}: {
  children: ReactNode;
  intensity?: PartyUpAtmosphereIntensity;
  crowd?: boolean;
  className?: string;
}) {
  return (
    <main className={`relative isolate min-h-screen overflow-x-hidden bg-[var(--partyup-bg-indigo)] text-white ${className}`}>
      <PartyUpAtmosphere intensity={intensity} crowd={crowd} />
      {children}
    </main>
  );
}
