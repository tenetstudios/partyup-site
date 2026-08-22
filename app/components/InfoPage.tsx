import Link from "next/link";
import React from "react";
import HomeFooter from "@/app/components/HomeFooter";
import HomeHeader from "@/app/components/HomeHeader";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";

export function InfoPageShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <PartyUpPageShell intensity="subtle" crowd>
      <HomeHeader />
      <article className="relative mx-auto w-full max-w-[900px] px-5 py-10 md:py-14">
        <header className="border-b border-purple-100/15 pb-7">
          {eyebrow && (
            <p className="text-sm font-black uppercase tracking-[0.18em] text-[#c35dff]">
              {eyebrow}
            </p>
          )}
          <h1 className="mt-2 text-4xl font-black tracking-normal md:text-5xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-4 max-w-2xl text-base font-bold leading-7 text-[#aaa4b8]">
              {subtitle}
            </p>
          )}
        </header>

        <div className="info-copy mt-8 space-y-8">{children}</div>
      </article>
      <HomeFooter />
    </PartyUpPageShell>
  );
}

export function InfoSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${partyUpTheme.glassCard} p-5 md:p-6`}>
      <h2 className="text-xl font-black">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] font-medium leading-7 text-[#c9c2d7]">
        {children}
      </div>
    </section>
  );
}

export function TextLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="font-black text-[#c35dff] hover:text-white">
      {children}
    </Link>
  );
}

export function InfoCtaRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-3">{children}</div>;
}

export function PrimaryCta({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
  tone?: "purple" | "pink";
}) {
  return (
    <Link
      href={href}
      className={`${partyUpTheme.primaryButton} h-11 px-5 text-sm`}
    >
      {children}
    </Link>
  );
}
