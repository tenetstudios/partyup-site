import type { Metadata } from "next";
import NetworkBalloonRoomsClient from "../dev/balloon-rooms/network/NetworkBalloonRoomsClient";

export const metadata: Metadata = { title: "Play Float" };

export default async function FloatPage({
  searchParams,
}: {
  searchParams: Promise<{ roomId?: string | string[] }>;
}) {
  const params = await searchParams;
  const roomValue = params.roomId;
  const initialRoomId = (Array.isArray(roomValue) ? roomValue[0] : roomValue) ?? null;
  return <NetworkBalloonRoomsClient initialCode="" initialRoomId={initialRoomId} />;
}
