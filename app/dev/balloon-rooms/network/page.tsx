import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NetworkBalloonRoomsClient from "./NetworkBalloonRoomsClient";

export const metadata: Metadata = {
  title: "Float Network Match",
  robots: { index: false, follow: false },
};

export default async function FloatNetworkPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const value = (await searchParams).code;
  const initialCode = (Array.isArray(value) ? value[0] : value)?.toUpperCase() ?? "";
  return <NetworkBalloonRoomsClient initialCode={initialCode} />;
}
