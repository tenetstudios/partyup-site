import type { Metadata } from "next";
import HomeHeader from "@/app/components/HomeHeader";
import AdminDashboard from "./AdminDashboard";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_-15%,rgba(104,45,180,0.25),transparent_32%),#07000f] text-white">
      <HomeHeader />
      <AdminDashboard />
    </main>
  );
}
