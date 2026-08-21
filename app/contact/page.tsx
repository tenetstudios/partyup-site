import type { Metadata } from "next";
import { InfoPageShell, InfoSection } from "@/app/components/InfoPage";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact PartyUp for questions, feedback, partnerships, safety concerns, technical support, or privacy questions.",
};

export default function ContactPage() {
  return (
    <InfoPageShell
      eyebrow="PartyUp"
      title="Contact PartyUp"
      subtitle="Questions, feedback, partnerships, safety concerns, or something else? Get in touch."
    >
      <InfoSection title="Contact Form">
        <form className="grid gap-4" aria-describedby="contact-pending-note">
          <label className="block">
            <span className="mb-1 block text-sm font-black text-white">Name</span>
            <input className="h-11 w-full rounded-md border border-white/10 bg-black/30 px-3 text-white outline-none focus:border-[#c35dff]" />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-black text-white">Email</span>
            <input type="email" className="h-11 w-full rounded-md border border-white/10 bg-black/30 px-3 text-white outline-none focus:border-[#c35dff]" />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-black text-white">Reason</span>
            <select className="h-11 w-full rounded-md border border-white/10 bg-black/30 px-3 text-white outline-none focus:border-[#c35dff]" defaultValue="General">
              <option>General</option>
              <option>Safety</option>
              <option>Partnerships / Events</option>
              <option>Technical Support</option>
              <option>Privacy</option>
              <option>Other</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-black text-white">Message</span>
            <textarea className="min-h-36 w-full rounded-md border border-white/10 bg-black/30 px-3 py-3 text-white outline-none focus:border-[#c35dff]" />
          </label>

          <p id="contact-pending-note" className="rounded-md border border-amber-300/20 bg-amber-950/30 px-4 py-3 text-sm font-bold text-amber-100">
            Contact submission wiring is pending. This form is shown for the V1 interface, but no message is sent yet.
          </p>

          <button
            type="button"
            disabled
            className="h-11 rounded-md bg-[#8b3dff] px-5 text-sm font-black text-white opacity-50"
          >
            Send Message
          </button>
        </form>
      </InfoSection>
    </InfoPageShell>
  );
}
