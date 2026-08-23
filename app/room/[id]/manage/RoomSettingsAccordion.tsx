"use client";

import { type ReactNode, useState } from "react";

type SectionKey = "roomBroadcast" | "engagement" | "safety" | "lifecycle";

type RoomSettingsAccordionProps = {
  defaultOpen?: SectionKey;
  engagement?: ReactNode;
  lifecycle?: ReactNode;
  roomBroadcast?: ReactNode;
  safety?: ReactNode;
};

const sectionDetails: Record<SectionKey, { title: string; subtitle: string }> = {
  roomBroadcast: {
    title: "Room & broadcast",
    subtitle: "Room details, guest entry, and what plays between live streams.",
  },
  engagement: {
    title: "Engagement",
    subtitle: "Announcements, missions, and activities for the room.",
  },
  safety: {
    title: "Safety & access",
    subtitle: "Chat controls, reports, queue operations, and participant cleanup.",
  },
  lifecycle: {
    title: "Event lifecycle",
    subtitle: "Close out the event, leave a recap note, or permanently delete it.",
  },
};

export default function RoomSettingsAccordion({
  defaultOpen = "roomBroadcast",
  engagement,
  lifecycle,
  roomBroadcast,
  safety,
}: RoomSettingsAccordionProps) {
  const [openSection, setOpenSection] = useState<SectionKey | null>(defaultOpen);
  const sections: Array<{ key: SectionKey; content?: ReactNode }> = [
    { key: "roomBroadcast", content: roomBroadcast },
    { key: "engagement", content: engagement },
    { key: "safety", content: safety },
    { key: "lifecycle", content: lifecycle },
  ];

  return (
    <div className="mt-8 space-y-3">
      {sections.map(({ key, content }) => {
        if (!content) return null;

        const expanded = openSection === key;
        const panelId = `room-settings-${key}`;
        const details = sectionDetails[key];

        return (
          <section
            key={key}
            className={`overflow-hidden rounded-xl border bg-[#12051e] transition-colors ${
              expanded ? "border-purple-300/40" : "border-white/10"
            }`}
          >
            <button
              type="button"
              aria-controls={panelId}
              aria-expanded={expanded}
              onClick={() => setOpenSection((current) => (current === key ? null : key))}
              className="flex w-full items-center gap-5 px-5 py-4 text-left hover:bg-white/[0.03]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-black text-white">{details.title}</span>
                <span className="mt-1 block text-sm leading-5 text-zinc-400">{details.subtitle}</span>
              </span>
              <span aria-hidden className="w-6 text-center text-2xl font-medium text-purple-300">
                {expanded ? "−" : "+"}
              </span>
            </button>

            {expanded && (
              <div
                id={panelId}
                className="divide-y divide-white/10 border-t border-white/10 [&>section]:mt-0 [&>section]:rounded-none [&>section]:border-0 [&>section]:bg-transparent"
              >
                {content}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
