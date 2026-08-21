"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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

  return <main className="min-h-screen bg-[#05040b] px-5 py-10 text-white"><form onSubmit={save} className="mx-auto max-w-2xl"><Link href={`/series/${id}`} className="text-sm font-bold text-[#c9a6ff]">Back to series</Link><h1 className="mt-10 text-4xl font-black">Edit Event Series</h1><div className="mt-8 space-y-5 rounded-lg border border-white/10 bg-[#111019] p-6"><label className="block"><span className="text-sm font-black">Series name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} required className="mt-2 h-12 w-full rounded-md border border-white/10 bg-black/30 px-4 outline-none focus:border-[#9b5cff]" /></label><label className="block"><span className="text-sm font-black">Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={5} className="mt-2 w-full resize-none rounded-md border border-white/10 bg-black/30 p-4 outline-none focus:border-[#9b5cff]" /></label><label className="block"><span className="text-sm font-black">Replace cover image</span><input type="file" accept="image/*" onChange={(event) => setCoverFile(event.target.files?.[0] || null)} className="mt-2 block w-full text-sm text-[#aaa4b8] file:mr-4 file:rounded-md file:border-0 file:bg-[#332247] file:px-4 file:py-3 file:font-bold file:text-white" /></label>{error && <p className="text-sm font-bold text-[#ff8cab]">{error}</p>}<button type="submit" disabled={saving || !name.trim() || Boolean(error && !name)} className="h-12 w-full rounded-md bg-[#8b3dff] font-black disabled:opacity-50">{saving ? "Saving..." : "Save changes"}</button></div></form></main>;
}
