"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import AccountFrame from "../AccountFrame";
import { partyUpTheme } from "@/app/components/PartyUpTheme";
import { updateMyProfile } from "@/lib/profileUpdates";
import { createSupabaseClient } from "@/lib/supabase";

type ProfileForm = {
  username: string;
  avatarUrl: string;
  bio: string;
  location: string;
};

const emptyForm: ProfileForm = { username: "", avatarUrl: "", bio: "", location: "" };

export default function PublicProfileEditor() {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      setUserId(user?.id ?? null);
      if (!user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("username, avatar_url, bio, location")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        setMessage({ tone: "error", text: error.message });
      } else if (data) {
        setForm({
          username: data.username ?? "",
          avatarUrl: data.avatar_url ?? "",
          bio: data.bio ?? "",
          location: data.location ?? "",
        });
      }
      setLoading(false);
    })();
  }, [supabase]);

  function change(field: keyof ProfileForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage(null);
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !userId) return;
    if (!file.type.startsWith("image/")) {
      setMessage({ tone: "error", text: "Choose an image file for your profile photo." });
      return;
    }

    setUploading(true);
    setMessage(null);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${userId}/avatar_${Date.now()}.${extension}`;
      const { error } = await supabase.storage.from("profile-images").upload(path, file, {
        contentType: file.type,
        upsert: true,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("profile-images").getPublicUrl(path);
      change("avatarUrl", data.publicUrl);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not upload that photo." });
    } finally {
      setUploading(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateMyProfile(supabase, {
        username: form.username,
        avatarUrl: form.avatarUrl,
        bio: form.bio,
        location: form.location,
        updateDetails: true,
      });
      if (result.status !== "updated") {
        setMessage({ tone: "error", text: result.message });
        return;
      }
      setForm((current) => ({ ...current, username: result.username ?? current.username }));
      setMessage({ tone: "success", text: result.message });
      window.dispatchEvent(new Event("partyup:profile-updated"));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not save your public profile." });
    } finally {
      setSaving(false);
    }
  }

  async function copyProfileLink() {
    if (!userId) return;
    await navigator.clipboard.writeText(`${window.location.origin}/user/${userId}`);
    setMessage({ tone: "success", text: "Public profile link copied." });
  }

  return (
    <AccountFrame
      eyebrow="What others see"
      title="Public Profile"
      subtitle="Everything on this page can appear to other PartyUp members. Your name is unique regardless of capitalization."
      backHref="/account"
    >
      {loading ? (
        <div className={`${partyUpTheme.glassCard} p-6 ${partyUpTheme.textSecondary}`}>Loading...</div>
      ) : !userId ? (
        <div className={`${partyUpTheme.emptyState} p-7`}>Sign in to edit your public profile.</div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
          <form onSubmit={save} className={`${partyUpTheme.glassElevated} space-y-5 p-6`}>
            <div className="flex items-center gap-4">
              {form.avatarUrl ? (
                <img src={form.avatarUrl} alt="Your profile" className="h-24 w-24 rounded-full object-cover" />
              ) : (
                <div className="grid h-24 w-24 place-items-center rounded-full bg-[#2a1747] text-2xl font-black">
                  {(form.username || "P").slice(0, 1).toUpperCase()}
                </div>
              )}
              <label className="min-w-0 flex-1 text-sm font-black text-white">
                Profile photo
                <input type="file" accept="image/*" disabled={uploading} onChange={uploadAvatar} className={`${partyUpTheme.fileInput} mt-2`} />
              </label>
            </div>

            <label className="block text-sm font-black">
              PartyUp name
              <input value={form.username} onChange={(event) => change("username", event.target.value.slice(0, 40))} minLength={2} maxLength={40} required className={`${partyUpTheme.input} mt-2 min-h-12 w-full px-4`} />
              <span className={`mt-2 block text-xs font-bold ${partyUpTheme.textMuted}`}>2–40 characters. Capitalization does not create a different name.</span>
            </label>

            <label className="block text-sm font-black">
              Bio
              <textarea value={form.bio} onChange={(event) => change("bio", event.target.value.slice(0, 280))} maxLength={280} rows={5} className={`${partyUpTheme.input} mt-2 w-full p-4`} placeholder="Tell people what you bring to the party." />
              <span className={`mt-1 block text-right text-xs ${partyUpTheme.textMuted}`}>{form.bio.length}/280</span>
            </label>

            <label className="block text-sm font-black">
              General location
              <input value={form.location} onChange={(event) => change("location", event.target.value.slice(0, 80))} maxLength={80} className={`${partyUpTheme.input} mt-2 min-h-12 w-full px-4`} placeholder="City or region — never an exact address" />
            </label>

            {message && <p role="status" className={`text-sm font-bold ${message.tone === "success" ? "text-emerald-300" : "text-pink-300"}`}>{message.text}</p>}

            <button type="submit" disabled={saving || uploading || form.username.trim().length < 2} className={`${partyUpTheme.primaryButton} w-full px-5 text-sm`}>
              {saving ? "Saving..." : uploading ? "Uploading..." : "Save public profile"}
            </button>
          </form>

          <aside className={`${partyUpTheme.glassCard} h-fit p-5`}>
            <p className={partyUpTheme.sectionLabel}>Public preview</p>
            <p className={`mt-3 text-sm leading-6 ${partyUpTheme.textSecondary}`}>Check the exact profile other people can open, or copy its link.</p>
            <div className="mt-5 grid gap-3">
              <Link href={`/user/${userId}`} className={`${partyUpTheme.ghostButton} px-4 text-sm`}>View public profile</Link>
              <button type="button" onClick={() => void copyProfileLink()} className={`${partyUpTheme.ghostButton} px-4 text-sm`}>Copy profile link</button>
            </div>
          </aside>
        </div>
      )}
    </AccountFrame>
  );
}
