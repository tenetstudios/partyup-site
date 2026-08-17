import React from "react";

export default function FeatureStrip() {
  const features = [
    {
      title: "Go Live",
      body: "Stream to your room with one tap.",
      icon: "M12 19a7 7 0 0 0 0-14m0 14a7 7 0 0 1 0-14m0 10a3 3 0 0 0 0-6m0 6a3 3 0 0 1 0-6m0 3v10",
    },
    {
      title: "Join Instantly",
      body: "No waiting rooms. Jump right in.",
      icon: "M8 20v-2a4 4 0 0 1 8 0v2M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 1a3 3 0 0 1 3 3v2M18 5a3 3 0 0 1 0 6M4 13a3 3 0 0 0-3 3v2M6 5a3 3 0 0 0 0 6",
    },
    {
      title: "Meet People",
      body: "Follow, connect, and hang out again.",
      icon: "M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z",
    },
    {
      title: "Anywhere",
      body: "IRL or online. PartyUp is everywhere.",
      icon: "M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    },
  ];

  return (
    <section>
      <div className="rounded-[10px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(14,14,24,0.92),rgba(10,9,18,0.92))] px-9 py-4">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div key={feature.title} className="flex items-center gap-5">
              <svg viewBox="0 0 24 24" className="h-10 w-10 shrink-0 text-[#9b4dff] drop-shadow-[0_0_12px_rgba(139,61,255,0.55)]" fill="none" aria-hidden="true">
                <path d={feature.icon} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
              <div>
                <h3 className="text-[16px] font-black leading-5 text-[#a855f7]">{feature.title}</h3>
                <p className="mt-1 max-w-[210px] text-[14px] leading-5 text-[#b8b2c6]">{feature.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
