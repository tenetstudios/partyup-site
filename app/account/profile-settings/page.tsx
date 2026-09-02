import type { Metadata } from "next";
import ProfileSettingsClient from "./ProfileSettingsClient";

export const metadata: Metadata = {
  title: "Profile Settings | PartyUp",
  description: "Manage private PartyUp account settings.",
};

export default function ProfileSettingsPage() {
  return <ProfileSettingsClient />;
}
