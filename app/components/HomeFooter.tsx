import Link from "next/link";
import React from "react";

export default function HomeFooter() {
  const links = [
    { label: "About", href: "/about" },
    { label: "Safety", href: "/safety" },
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Contact", href: "/contact" },
  ];

  return (
    <footer className="mx-auto flex w-full max-w-[620px] flex-wrap items-center justify-center gap-x-9 gap-y-3 px-5 py-4 text-sm text-[#777384]">
      <span>© 2026 PartyUp.io</span>
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="transition hover:text-white">
          {link.label}
        </Link>
      ))}
    </footer>
  );
}
