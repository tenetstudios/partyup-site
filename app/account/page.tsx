import type { Metadata } from "next";
import AccountManagementClient from "./AccountManagementClient";

export const metadata: Metadata = {
  title: "Account Management | PartyUp",
  description: "Manage your PartyUp public profile and private account settings.",
};

export default function AccountPage() {
  return <AccountManagementClient />;
}
