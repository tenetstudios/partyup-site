import Link from "next/link";
import type { ReactNode } from "react";
import HomeHeader from "@/app/components/HomeHeader";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";

export default function AccountFrame({
  eyebrow,
  title,
  subtitle,
  children,
  backHref,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  backHref?: string;
}) {
  return (
    <PartyUpPageShell intensity="standard">
      <HomeHeader />
      <div className="mx-auto w-full max-w-4xl px-5 py-8 md:py-12">
        {backHref && (
          <Link href={backHref} className={`${partyUpTheme.ghostButton} mb-6 px-4 text-sm`}>
            Back
          </Link>
        )}
        <p className={partyUpTheme.sectionLabel}>{eyebrow}</p>
        <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">{title}</h1>
        <p className={`mt-3 max-w-2xl text-sm leading-6 ${partyUpTheme.textSecondary}`}>
          {subtitle}
        </p>
        <div className="mt-8">{children}</div>
      </div>
    </PartyUpPageShell>
  );
}
