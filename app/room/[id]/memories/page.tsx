import RoomMemoriesClient from "../RoomMemoriesClient";

export default async function RoomMemoriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ missionId?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const missionId = Array.isArray(query.missionId) ? query.missionId[0] : query.missionId;

  return <RoomMemoriesClient roomId={id} missionId={missionId ?? null} />;
}
