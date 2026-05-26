import Link from "next/link";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="grid min-h-screen place-items-center bg-[#07000f] px-5 text-white">
      <section className="w-full max-w-xl rounded-lg border border-purple-300/20 bg-[#12051e] p-8 text-center shadow-2xl shadow-purple-950/40">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-purple-300">
          Room {id}
        </p>
        <h1 className="mt-4 text-4xl font-black">
          Open this room in the PartyUp app.
        </h1>
        <Link
          href="/"
          className="mt-8 inline-flex rounded-md bg-[#9146ff] px-5 py-3 text-sm font-black hover:bg-[#7b31e8]"
        >
          Back to live rooms
        </Link>
      </section>
    </main>
  );
}
