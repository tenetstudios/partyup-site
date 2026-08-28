import Link from "next/link";
import LightningTriviaClient from "./LightningTriviaClient";

export default async function LightningTriviaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="min-h-dvh bg-[radial-gradient(circle_at_50%_0%,rgba(234,179,8,0.16),transparent_35%),#07000f] text-white">
    <div className="mx-auto min-h-dvh max-w-3xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <Link href={`/room/${id}`} className="inline-flex min-h-11 items-center rounded-lg border border-white/15 px-4 text-sm font-black">← Room</Link>
      <LightningTriviaClient roomId={id} />
    </div>
  </main>;
}
