import React from "react";

export default function FeatureStrip() {
  const features = ["Go Live", "Join Instantly", "Meet People", "Anywhere"];

  return (
    <section className="mx-auto max-w-7xl px-5 py-6">
      <div className="rounded-lg border border-white/10 bg-[#0b0410] p-4">
        <div className="flex items-center justify-between gap-4 overflow-x-auto">
          {features.map((f) => (
            <div key={f} className="flex items-center gap-3 rounded-md px-3 py-2">
              <div className="h-8 w-8 rounded-full bg-[#9146ff]" />
              <div className="font-black text-sm">{f}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
