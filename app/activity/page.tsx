import HomeHeader from "@/app/components/HomeHeader";

export default function ActivityPage() {
  return (
    <main className="min-h-screen bg-[#05040b] text-white">
      <HomeHeader />

      <section className="mx-auto w-full max-w-[1458px] px-5 py-8 xl:px-0">
        <div className="border-b border-white/10 pb-6">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-[#c35dff]">PartyUp</p>
          <h1 className="mt-2 text-4xl font-black tracking-normal md:text-5xl">Activity</h1>
          <p className="mt-3 text-sm font-bold leading-6 text-[#aaa4b8]">Updates from rooms, people, and connections.</p>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {["Recent", "Connections", "Rooms"].map((section) => (
            <section key={section} className="rounded-lg border border-white/10 bg-[#10101a] p-5">
              <h2 className="text-lg font-black">{section}</h2>
              <div className="mt-5 grid min-h-[180px] place-items-center rounded-md border border-dashed border-purple-300/20 bg-black/20 p-5 text-center">
                <p className="text-sm font-bold leading-6 text-[#aaa4b8]">Activity will appear here as PartyUp updates roll in.</p>
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
