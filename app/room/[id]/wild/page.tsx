import WildClient from "./WildClient";

export default async function WildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WildClient roomId={id} />;
}
