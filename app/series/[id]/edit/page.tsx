"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import HomeHeader from "@/app/components/HomeHeader";
import { PartyUpPageShell, partyUpTheme } from "@/app/components/PartyUpTheme";
import { getEventSeriesProfile } from "@/lib/eventSeries";
import { createSupabaseClient } from "@/lib/supabase";

export default function EditSeriesPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getEventSeriesProfile(createSupabaseClient(), id).then((series) => {
      if (!series?.is_owner) throw new Error("Only the series host can edit it.");
      setName(series.name); setDescription(series.description || ""); setCoverImageUrl(series.cover_image_url);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Series unavailable."));
  }, [id]);

  async function save(event: FormEvent) {
    event.preventDefault(); if (!name.trim() || saving) return; setSaving(true); setError(null);
    try {
      const supabase = createSupabaseClient();
      let nextCover = coverImageUrl;
      if (coverFile) {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error("Sign in to edit this series.");
        const extension = coverFile.name.split(".").pop() || "jpg";
        const path = `${userData.user.id}/series-${Date.now()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("event-images").upload(path, coverFile);
        if (uploadError) throw uploadError;
        nextCover = supabase.storage.from("event-images").getPublicUrl(path).data.publicUrl;
      }
      const { error: updateError } = await supabase.rpc("update_event_series", { p_series_id: id, p_name: name.trim(), p_description: description.trim() || null, p_cover_image_url: nextCover });
      if (updateError) throw updateError;
      router.push(`/series/${id}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Series could not be updated."); setSaving(false); }
  }

  return (
    <PartyUpPageShell intensity="standard">
      <HomeHeader />
      <form onSubmit={save} className="relative mx-auto max-w-2xl px-5 py-10">
        <Link href={`/series/${id}`} className="text-sm font-bold text-[#c9a6ff] hover:text-white">Back to series</Link>
        <h1 className="mt-10 text-4xl font-black">Edit Event Series</h1>
        <div className={`${partyUpTheme.glassElevated} mt-8 space-y-5 p-6`}>
          <label className="block">
            <span className="text-sm font-black">Series name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required className={`${partyUpTheme.input} mt-2 h-12 w-full px-4`} />
          </label>
          <label className="block">
            <span className="text-sm font-black">Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={5} className={`${partyUpTheme.input} mt-2 w-full resize-none p-4`} />
          </label>
          <label className="block">
            <span className="text-sm font-black">Replace cover image</span>
            <input type="file" accept="image/*" onChange={(event) => setCoverFile(event.target.files?.[0] || null)} className={`${partyUpTheme.fileInput} mt-2`} />
          </label>
          {error && <p className="text-sm font-bold text-[#ff8cab]">{error}</p>}
          <button type="submit" disabled={saving || !name.trim() || Boolean(error && !name)} className={`${partyUpTheme.primaryButton} h-12 w-full`}>{saving ? "Saving..." : "Save changes"}</button>
        </div>
      </form>
    </PartyUpPageShell>
  );
}
