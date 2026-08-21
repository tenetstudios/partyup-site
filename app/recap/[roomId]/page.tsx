import RecapClient from "./RecapClient";

export default async function RecapPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <RecapClient roomId={roomId} />;
}
