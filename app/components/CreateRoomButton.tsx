"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase";

type CreateRoomStatus = "live" | "scheduled";

const TIME_OPTIONS = ["18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "00:00", "01:00"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function toDateValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getDefaultSchedule() {
  const date = new Date();
  const hour = date.getHours();

  if (hour >= 22) {
    date.setDate(date.getDate() + 1);
  }

  return {
    date: toDateValue(date),
    time: hour >= 22 ? "20:00" : "21:00",
    month: new Date(date.getFullYear(), date.getMonth(), 1),
  };
}

function getCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const days: (Date | null)[] = Array.from({ length: firstDay.getDay() }, () => null);

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    days.push(new Date(month.getFullYear(), month.getMonth(), day));
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

function formatDateLabel(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatTimeLabel(timeValue: string) {
  const [hours, minutes] = timeValue.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getScheduledAt(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);

  return new Date(year, month - 1, day, hours, minutes).toISOString();
}

export default function CreateRoomButton({
  className = "",
  label = "Open a Room",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState("");
  const [maxUsers, setMaxUsers] = useState("12");
  const [isPrivateRoom, setIsPrivateRoom] = useState(false);
  const [roomType, setRoomType] = useState("party");
  const [roomMode, setRoomMode] = useState("livestream");
  const [roomStatus, setRoomStatus] = useState<CreateRoomStatus>("live");
  const [venueName, setVenueName] = useState("");
  const [scheduledDate, setScheduledDate] = useState(() => getDefaultSchedule().date);
  const [scheduledTime, setScheduledTime] = useState(() => getDefaultSchedule().time);
  const [calendarMonth, setCalendarMonth] = useState(() => getDefaultSchedule().month);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const calendarDays = getCalendarDays(calendarMonth);
  const todayValue = toDateValue(new Date());

  function openCreateRoom() {
    setRoomStatus("live");
    setOpen(true);
  }

  function resetSchedule() {
    const defaultSchedule = getDefaultSchedule();

    setScheduledDate(defaultSchedule.date);
    setScheduledTime(defaultSchedule.time);
    setCalendarMonth(defaultSchedule.month);
  }
  
  async function createRoom() {
  if (loading) return;

  if (!title.trim()) {
    alert("Enter a room name");
    return;
  }

  setLoading(true);

  try {
    const supabase = createSupabaseClient();

    console.time("getUser");

const { data: userData } = await supabase.auth.getUser();

console.timeEnd("getUser");

const user = userData.user;

    if (!user) {
      alert("You need to sign in first.");
      setLoading(false);
      return;
    }

    let coverImage: string | null = null;

    if (coverFile) {
      const fileExt = coverFile.name.split(".").pop() || "jpg";
      const filePath = `${user.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("event-images")
        .upload(filePath, coverFile);

      if (uploadError) {
        alert(uploadError.message);
        setLoading(false);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("event-images")
        .getPublicUrl(filePath);

      coverImage = publicUrlData.publicUrl;
    }

    console.time("roomInsert");

const { data: insertedRoom, error: roomError } = await supabase
  .from("event_rooms")
  .insert({
        title: title.trim(),
        host_id: user.id,
        cover_image: coverImage,
        current_users: 0,
        queue_count: 0,
        max_users: Number(maxUsers) || 12,
        is_private: isPrivateRoom,
        type: roomType,
        mode: roomMode,
        status: roomStatus,
        scheduled_at:
          roomStatus === "scheduled" ? getScheduledAt(scheduledDate, scheduledTime) : null,
        venue_name: venueName.trim() || null,
        latitude: null,
        longitude: null,
        last_active_at: new Date().toISOString(),
      })
      .select("id")
      .single();
      console.timeEnd("roomInsert");

    if (roomError || !insertedRoom?.id) {
      alert(roomError?.message || "Room could not be created.");
      setLoading(false);
      return;
    }

    console.time("attendeeUpsert");

    const { error: attendeeError } = await supabase
      .from("event_attendees")
      .upsert(
        {
          event_room_id: insertedRoom.id,
          user_id: user.id,
          username:
  user.user_metadata?.full_name ||
  user.user_metadata?.name ||
  "Host",

avatar_url:
  user.user_metadata?.avatar_url ||
  user.user_metadata?.picture ||
  "",
          status: "accepted",
          can_stream: true,
          stream_status: "off",
        },
        {
          onConflict: "event_room_id,user_id",
        },
      );
console.timeEnd("attendeeUpsert");

    if (attendeeError) {
      alert(attendeeError.message);
      setLoading(false);
      return;
    }

    setTitle("");
    setMaxUsers("12");
    setIsPrivateRoom(false);
    setRoomType("party");
    setRoomMode("livestream");
    setRoomStatus("live");
    setVenueName("");
    resetSchedule();
    setCoverFile(null);
    setOpen(false);
    setLoading(false);

    router.push(`/room/${insertedRoom.id}`);
  } catch (error) {
    console.error(error);
    alert("Room could not be created.");
    setLoading(false);
  }
}

  return (
    <>
      <button
        onClick={openCreateRoom}
        className={`h-10 rounded-md bg-[#8b3dff] px-6 text-[15px] font-black shadow-[0_0_22px_rgba(139,61,255,0.35)] hover:bg-[#7b31e8] ${className}`}
      >
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#12051e] p-5 text-white shadow-2xl shadow-purple-950/50">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-purple-300">
                  PartyUp
                </p>
                <h2 className="text-2xl font-black">Open a Room</h2>
              </div>

              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-white/15 px-3 py-2 text-sm font-black hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-black">Room name</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Late night party room"
                  className="w-full rounded-md bg-black px-3 py-3 text-white outline-none placeholder:text-zinc-500"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-black">Type</span>
                  <select
                    value={roomType}
                    onChange={(event) => setRoomType(event.target.value)}
                    className="w-full rounded-md bg-black px-3 py-3 text-white outline-none"
                  >
                    <option value="party">Party</option>
<option value="concert">Concert</option>
<option value="dj_set">DJ Set</option>
<option value="popup">Pop-Up</option>
<option value="sports">Sports</option>
<option value="watch_party">Watch Party</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-sm font-black">Mode</span>
                  <select
                    value={roomMode}
                    onChange={(event) => setRoomMode(event.target.value)}
                    className="w-full rounded-md bg-black px-3 py-3 text-white outline-none"
                  >
                    <option value="livestream">Livestream</option>
                    <option value="irl">IRL</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-black">
                    Max users
                  </span>
                  <input
                    value={maxUsers}
                    onChange={(event) => setMaxUsers(event.target.value)}
                    inputMode="numeric"
                    className="w-full rounded-md bg-black px-3 py-3 text-white outline-none"
                  />
                </label>

              </div>

              <section className="rounded-xl border border-white/10 bg-black/35 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <span className="block text-sm font-black">When</span>
                    <span className="text-xs font-bold text-zinc-500">
                      {roomStatus === "live"
                        ? "Start immediately"
                        : `${formatDateLabel(scheduledDate)} at ${formatTimeLabel(scheduledTime)}`}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 rounded-md bg-black p-1 text-sm font-black">
                    <button
                      type="button"
                      onClick={() => setRoomStatus("live")}
                      className={`rounded px-3 py-2 ${
                        roomStatus === "live" ? "bg-[#9146ff] text-white" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Live now
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoomStatus("scheduled")}
                      className={`rounded px-3 py-2 ${
                        roomStatus === "scheduled" ? "bg-[#9146ff] text-white" : "text-zinc-400 hover:text-white"
                      }`}
                    >
                      Schedule
                    </button>
                  </div>
                </div>

                {roomStatus === "scheduled" && (
                  <div className="rounded-lg border border-purple-400/15 bg-[#160824] p-3">
                    <div className="mb-3 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() =>
                          setCalendarMonth(
                            (current) => new Date(current.getFullYear(), current.getMonth() - 1, 1),
                          )
                        }
                        className="rounded-md border border-white/10 px-3 py-2 text-sm font-black text-zinc-300 hover:bg-white/10"
                        aria-label="Previous month"
                      >
                        Prev
                      </button>
                      <p className="text-sm font-black">
                        {new Intl.DateTimeFormat(undefined, {
                          month: "long",
                          year: "numeric",
                        }).format(calendarMonth)}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setCalendarMonth(
                            (current) => new Date(current.getFullYear(), current.getMonth() + 1, 1),
                          )
                        }
                        className="rounded-md border border-white/10 px-3 py-2 text-sm font-black text-zinc-300 hover:bg-white/10"
                        aria-label="Next month"
                      >
                        Next
                      </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-black uppercase text-zinc-500">
                      {WEEKDAYS.map((day) => (
                        <span key={day}>{day}</span>
                      ))}
                    </div>
                    <div className="mt-2 grid grid-cols-7 gap-1">
                      {calendarDays.map((day, index) => {
                        const dateValue = day ? toDateValue(day) : "";
                        const selected = dateValue === scheduledDate;
                        const disabled = day ? dateValue < todayValue : true;

                        return (
                          <button
                            key={day ? dateValue : `blank-${index}`}
                            type="button"
                            disabled={disabled}
                            onClick={() => day && setScheduledDate(dateValue)}
                            className={`aspect-square rounded-md text-sm font-black ${
                              selected
                                ? "bg-[#9146ff] text-white"
                                : disabled
                                  ? "text-zinc-700"
                                  : "bg-black/45 text-zinc-200 hover:bg-white/10"
                            }`}
                          >
                            {day ? day.getDate() : ""}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-4">
                      <p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-purple-300">
                        Time
                      </p>
                      <div className="grid grid-cols-4 gap-2">
                        {TIME_OPTIONS.map((time) => (
                          <button
                            key={time}
                            type="button"
                            onClick={() => setScheduledTime(time)}
                            className={`rounded-md border px-2 py-2 text-sm font-black ${
                              scheduledTime === time
                                ? "border-[#9146ff] bg-[#9146ff] text-white"
                                : "border-white/10 bg-black/45 text-zinc-300 hover:bg-white/10"
                            }`}
                          >
                            {formatTimeLabel(time)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <label className="block">
  <span className="mb-1 block text-sm font-black">
    Venue name
  </span>
  <input
    value={venueName}
    onChange={(event) => setVenueName(event.target.value)}
    placeholder="Optional"
    className="w-full rounded-md bg-black px-3 py-3 text-white outline-none placeholder:text-zinc-500"
  />
</label>

<label className="block">
  <span className="mb-1 block text-sm font-black">
    Cover Image
  </span>

  <input
    type="file"
    accept="image/*"
    onChange={(event) =>
      setCoverFile(event.target.files?.[0] ?? null)
    }
    className="w-full rounded-md bg-black px-3 py-3 text-white"
  />
</label>

<label className="flex items-center justify-between rounded-md bg-black/40 px-3 py-3">
                <span>
                  <span className="block text-sm font-black">Private room</span>
                  <span className="text-xs text-zinc-500">
                    Hide from public browsing later.
                  </span>
                </span>

                <input
                  type="checkbox"
                  checked={isPrivateRoom}
                  onChange={(event) => setIsPrivateRoom(event.target.checked)}
                  className="h-5 w-5"
                />
              </label>

              <button
                onClick={createRoom}
                disabled={loading}
                className="w-full rounded-md bg-[#9146ff] px-5 py-3 font-black hover:bg-[#7b31e8] disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Room"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
