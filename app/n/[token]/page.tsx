import LiveNodeClaimClient from "./LiveNodeClaimClient";

export default async function LiveNodePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <LiveNodeClaimClient token={token} />;
}
