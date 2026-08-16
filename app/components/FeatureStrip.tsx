import React from "react";

export default function FeatureStrip() {
  const features = ["Go Live", "Join Instantly", "Meet People", "Anywhere"];

  return (
    <section className="mx-auto max-w-7xl px-5 py-8">
      <div className="grid gap-4 rounded-lg border border-white/10 bg-[#0b0410] p-6 sm:grid-cols-4">
        {features.map((f) => (
          <div key={f} className="flex flex-col items-center gap-2 p-3 text-center">
            <div className="h-12 w-12 rounded-full bg-[#9146ff]" />
            <div className="font-black">{f}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
