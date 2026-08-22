import type { Metadata } from "next";
import { InfoPageShell, InfoSection } from "@/app/components/InfoPage";
import { partyUpTheme } from "@/app/components/PartyUpTheme";

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
            <input className={`${partyUpTheme.input} h-11 w-full px-3`} />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-black text-white">Email</span>
            <input type="email" className={`${partyUpTheme.input} h-11 w-full px-3`} />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-black text-white">Reason</span>
            <select className={`${partyUpTheme.input} h-11 w-full px-3`} defaultValue="General">
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
            <textarea className={`${partyUpTheme.input} min-h-36 w-full px-3 py-3`} />
          </label>

          <p id="contact-pending-note" className="rounded-md border border-amber-300/20 bg-amber-950/30 px-4 py-3 text-sm font-bold text-amber-100">
            Contact submission wiring is pending. This form is shown for the V1 interface, but no message is sent yet.
          </p>

          <button
            type="button"
            disabled
            className={`${partyUpTheme.primaryButton} h-11 px-5 text-sm`}
          >
            Send Message
          </button>
        </form>
      </InfoSection>
    </InfoPageShell>
  );
}
