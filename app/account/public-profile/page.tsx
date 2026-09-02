import type { Metadata } from "next";
import PublicProfileEditor from "./PublicProfileEditor";

export const metadata: Metadata = {
  title: "Public Profile | PartyUp",
  description: "Edit the PartyUp profile information other people can see.",
};

export default function PublicProfilePage() {
  return <PublicProfileEditor />;
}
