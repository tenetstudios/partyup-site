import RoomMemoriesClient from "../RoomMemoriesClient";

export default async function RoomMemoriesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <RoomMemoriesClient roomId={id} />;
}
