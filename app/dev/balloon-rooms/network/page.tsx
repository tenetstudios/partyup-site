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
  searchParams: Promise<{ code?: string | string[]; roomId?: string | string[] }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const params = await searchParams;
  const value = params.code;
  const roomValue = params.roomId;
  const initialCode = (Array.isArray(value) ? value[0] : value)?.toUpperCase() ?? "";
  const initialRoomId = (Array.isArray(roomValue) ? roomValue[0] : roomValue) ?? null;
  return <NetworkBalloonRoomsClient initialCode={initialCode} initialRoomId={initialRoomId} />;
}
