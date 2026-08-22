"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import HomeHeader from "@/app/components/HomeHeader";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";
import { createSupabaseClient } from "@/lib/supabase";

export default function NewSeriesPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createSeries(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);

    try {
      const supabase = createSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) throw new Error("Sign in to create an Event Series.");

      let coverImageUrl: string | null = null;
      if (coverFile) {
        const extension = coverFile.name.split(".").pop() || "jpg";
        const path = `${user.id}/series-${Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("event-images").upload(path, coverFile);
        if (uploadError) throw uploadError;
        coverImageUrl = supabase.storage.from("event-images").getPublicUrl(path).data.publicUrl;
      }

      const { data, error: createError } = await supabase.rpc("create_event_series", {
        p_name: name.trim(),
        p_description: description.trim() || null,
        p_cover_image_url: coverImageUrl,
      });
      if (createError) throw createError;
      router.push(`/series/${data}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Series could not be created.");
      setSaving(false);
    }
  }

  return (
    <PartyUpPageShell intensity="standard">
      <HomeHeader />
      <div className="relative mx-auto max-w-2xl px-5 py-10">
        <Link href="/" className="text-sm font-bold text-[#c9a6ff] hover:text-white">Back</Link>
        <p className="mt-10 text-xs font-black uppercase text-[#ff63a8]">Host tools</p>
        <h1 className="mt-2 text-4xl font-black">Create Event Series</h1>
        <p className="mt-3 text-[#aaa4b8]">Give recurring events one persistent home.</p>

        <form onSubmit={createSeries} className={`${partyUpTheme.glassElevated} mt-8 space-y-5 p-6`}>
          <label className="block">
            <span className="text-sm font-black">Series name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required placeholder="Sundays @ XYZ" className={`${partyUpTheme.input} mt-2 h-12 w-full px-4`} />
          </label>
          <label className="block">
            <span className="text-sm font-black">Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={5} placeholder="What people can expect each time" className={`${partyUpTheme.input} mt-2 w-full resize-none p-4`} />
          </label>
          <label className="block">
            <span className="text-sm font-black">Cover image</span>
            <input type="file" accept="image/*" onChange={(event) => setCoverFile(event.target.files?.[0] || null)} className={`${partyUpTheme.fileInput} mt-2`} />
          </label>
          {error && <p className="text-sm font-bold text-[#ff8cab]">{error}</p>}
          <button type="submit" disabled={saving || !name.trim()} className={`${partyUpTheme.primaryButton} h-12 w-full`}>{saving ? "Creating..." : "Create Series"}</button>
        </form>
      </div>
    </PartyUpPageShell>
  );
}
