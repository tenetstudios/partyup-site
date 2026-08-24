"use client";
import Link from "next/link";
import React from "react";

export default function MatchDisconnected({
  message = "The call has ended. You can match again or return to PartyUp.",
  onRematch,
  returnHref = "/",
  returnLabel = "Return Home",
}: {
  message?: string;
  onRematch?: () => void;
  returnHref?: string;
  returnLabel?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-lg border border-fuchsia-400/20 bg-[linear-gradient(145deg,rgba(17,6,28,0.98),rgba(37,8,48,0.9),rgba(10,5,20,0.98))] p-6 text-center shadow-[0_28px_90px_rgba(156,39,176,0.18)] sm:p-10">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-300">Momentum reset</p>
        <h2 className="mt-2 text-3xl font-extrabold">That moment wrapped.</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-zinc-300">{message}</p>
        <p className="mt-5 text-sm font-bold text-white">Your next connection is one signal away.</p>
        <div className="mt-7 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <button onClick={onRematch} className="min-h-12 rounded-full bg-pink-500 px-6 py-3 font-black text-white transition hover:-translate-y-0.5 hover:bg-pink-400 active:translate-y-0">Find someone new</button>
          <Link href={returnHref} className="px-5 py-3 text-sm font-bold text-zinc-300 hover:text-white">{returnLabel}</Link>
        </div>
      </div>
    </div>
  );
}
