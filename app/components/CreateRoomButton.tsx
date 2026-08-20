"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase";

type CreateRoomStatus = "live" | "scheduled";
type TimePeriod = "AM" | "PM";

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
  const defaultHour = hour >= 22 ? 20 : 21;

  if (hour >= 22) {
    date.setDate(date.getDate() + 1);
  }

  return {
    date: toDateValue(date),
    hour: defaultHour > 12 ? defaultHour - 12 : defaultHour,
    minute: 0,
    month: new Date(date.getFullYear(), date.getMonth(), 1),
    period: (defaultHour >= 12 ? "PM" : "AM") as TimePeriod,
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

function getTwentyFourHour(hour: number, period: TimePeriod) {
  if (period === "AM") {
    return hour === 12 ? 0 : hour;
  }

  return hour === 12 ? 12 : hour + 12;
}

function formatTimeLabel(hour: number, minute: number, period: TimePeriod) {
  const date = new Date();
  date.setHours(getTwentyFourHour(hour, period), minute, 0, 0);

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getScheduledAt(dateValue: string, hour: number, minute: number, period: TimePeriod) {
  const [year, month, day] = dateValue.split("-").map(Number);

  return new Date(year, month - 1, day, getTwentyFourHour(hour, period), minute).toISOString();
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
  const [scheduledHour, setScheduledHour] = useState(() => getDefaultSchedule().hour);
  const [scheduledMinute, setScheduledMinute] = useState(() => getDefaultSchedule().minute);
  const [scheduledPeriod, setScheduledPeriod] = useState<TimePeriod>(() => getDefaultSchedule().period);
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
    setScheduledHour(defaultSchedule.hour);
    setScheduledMinute(defaultSchedule.minute);
    setScheduledPeriod(defaultSchedule.period);
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
          roomStatus === "scheduled"
            ? getScheduledAt(scheduledDate, scheduledHour, scheduledMinute, scheduledPeriod)
            : null,
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
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 px-4 py-10 sm:pt-16 sm:pb-12">
          <div className="mx-auto max-h-[calc(100vh-5rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#12051e] p-5 text-white shadow-2xl shadow-purple-950/50 sm:max-h-[calc(100vh-7rem)]">
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
                        : `${formatDateLabel(scheduledDate)} at ${formatTimeLabel(
                            scheduledHour,
                            scheduledMinute,
                            scheduledPeriod,
                          )}`}
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
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-purple-300">
                          Time
                        </p>
                        <p className="rounded-md bg-black/60 px-3 py-2 text-lg font-black text-white">
                          {formatTimeLabel(scheduledHour, scheduledMinute, scheduledPeriod)}
                        </p>
                      </div>

                      <label className="block rounded-lg bg-black/35 p-3">
                        <span className="mb-2 flex items-center justify-between text-xs font-black uppercase tracking-[0.14em] text-zinc-400">
                          Hour
                          <span className="text-purple-200">{scheduledHour}</span>
                        </span>
                        <input
                          type="range"
                          min="1"
                          max="12"
                          step="1"
                          value={scheduledHour}
                          onChange={(event) => setScheduledHour(Number(event.target.value))}
                          className="w-full accent-[#9146ff]"
                        />
                      </label>

                      <label className="mt-3 block rounded-lg bg-black/35 p-3">
                        <span className="mb-2 flex items-center justify-between text-xs font-black uppercase tracking-[0.14em] text-zinc-400">
                          Minute
                          <span className="text-purple-200">{pad(scheduledMinute)}</span>
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="55"
                          step="5"
                          value={scheduledMinute}
                          onChange={(event) => setScheduledMinute(Number(event.target.value))}
                          className="w-full accent-[#9146ff]"
                        />
                      </label>

                      <div className="mt-3 grid grid-cols-2 rounded-md bg-black p-1 text-sm font-black">
                        {(["AM", "PM"] as TimePeriod[]).map((period) => (
                          <button
                            key={period}
                            type="button"
                            onClick={() => setScheduledPeriod(period)}
                            className={`rounded px-3 py-2 ${
                              scheduledPeriod === period
                                ? "bg-[#9146ff] text-white"
                                : "text-zinc-400 hover:text-white"
                            }`}
                          >
                            {period}
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
