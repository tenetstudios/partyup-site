import RedeemConnectionClient from "./RedeemConnectionClient";

export default async function RedeemConnectionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <RedeemConnectionClient token={token} />;
}
