import Link from "next/link";
import React from "react";

export default function MatchCard() {
  return (
    <div className="h-[357px] rounded-[10px] border border-pink-500/35 bg-[radial-gradient(circle_at_55%_42%,rgba(255,45,154,0.24),transparent_31%),linear-gradient(150deg,rgba(40,12,61,0.96),rgba(82,12,58,0.74)_48%,rgba(21,10,31,0.95))] p-7 shadow-[0_0_34px_rgba(240,44,145,0.18)]">
      <h3 className="text-[25px] font-black leading-none text-[#e9ceff]">Match</h3>
      <p className="mt-3 text-[16px] leading-6 text-[#d4cfdd]">
        Meet someone new
        <br />
        in seconds.
      </p>

      <div className="my-7 flex justify-center">
        <svg viewBox="0 0 128 82" className="h-[82px] w-[128px] drop-shadow-[0_0_18px_rgba(255,45,154,0.45)]" fill="none" aria-hidden="true">
          <circle cx="44" cy="39" r="32" stroke="#a855f7" strokeWidth="6" />
          <circle cx="82" cy="39" r="32" stroke="#ff2d9a" strokeWidth="6" />
          <path d="m23 63-10 15 23-10M102 63l12 15-25-10" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" stroke="#d849da" />
          <path d="M34 35h.1M54 35h.1M38 51c6 6 16 6 22 0M73 35h.1M93 35h.1M77 51c6 6 16 6 22 0" strokeLinecap="round" strokeWidth="8" stroke="#c084fc" />
        </svg>
      </div>

      <div className="mb-5 flex items-center justify-center gap-1.5 text-[13px] text-[#bdb4ca]">
        <span className="h-2 w-2 rounded-full bg-[#55e987]" />
        Online status unavailable
      </div>

      <Link href="/match" className="grid h-[46px] place-items-center rounded-md bg-[#f02c91] text-[15px] font-black text-white shadow-[0_12px_30px_rgba(240,44,145,0.28)] hover:bg-[#ff3d9f]">
        Start Matching
      </Link>

      <a href="/match" className="mt-4 block text-center text-[13px] text-[#b9a9c5] hover:text-white">
        How it works <span className="inline-grid h-4 w-4 place-items-center rounded-full bg-white/18 text-[10px]">i</span>
      </a>
    </div>
  );
}
