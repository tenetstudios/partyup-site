import React from "react";

export default function HomeFooter() {
  const links = ["About", "Safety", "Privacy", "Terms", "Contact"];

  return (
    <footer className="mx-auto flex w-full max-w-[620px] flex-wrap items-center justify-center gap-x-9 gap-y-3 px-5 py-4 text-sm text-[#777384]">
      <span>© 2026 PartyUp.io</span>
      {links.map((link) => (
        <a key={link} href="#" className="transition hover:text-white">
          {link}
        </a>
      ))}
    </footer>
  );
}
