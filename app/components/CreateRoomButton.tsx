"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseClient } from "@/lib/supabase";
import { EventSeriesSummary, getMyEventSeries } from "@/lib/eventSeries";

type CreateRoomStatus = "live" | "scheduled";
type TimePeriod = "AM" | "PM";
type WizardStep = 0 | 1 | 2 | 3;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WIZARD_STEPS = ["Basics", "When", "Details", "Review"];

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
  const [currentStep, setCurrentStep] = useState<WizardStep>(0);
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
  const [series, setSeries] = useState<EventSeriesSummary[]>([]);
  const [seriesId, setSeriesId] = useState("");

  useEffect(() => {
    if (!open) return;
    getMyEventSeries(createSupabaseClient()).then(setSeries).catch(() => setSeries([]));
  }, [open]);

  const calendarDays = getCalendarDays(calendarMonth);
  const todayValue = toDateValue(new Date());
  const scheduledLabel = `${formatDateLabel(scheduledDate)} at ${formatTimeLabel(
    scheduledHour,
    scheduledMinute,
    scheduledPeriod,
  )}`;

  function openCreateRoom() {
    setRoomStatus("live");
    setCurrentStep(0);
    setOpen(true);
  }

  function closeCreateRoom() {
    setOpen(false);
    setCurrentStep(0);
  }

  function resetSchedule() {
    const defaultSchedule = getDefaultSchedule();

    setScheduledDate(defaultSchedule.date);
    setScheduledHour(defaultSchedule.hour);
    setScheduledMinute(defaultSchedule.minute);
    setScheduledPeriod(defaultSchedule.period);
    setCalendarMonth(defaultSchedule.month);
  }

  function goToNextStep() {
    if (currentStep === 0 && !title.trim()) {
      alert("Enter a room name");
      return;
    }

    setCurrentStep((step) => Math.min(step + 1, 3) as WizardStep);
  }

  function goToPreviousStep() {
    setCurrentStep((step) => Math.max(step - 1, 0) as WizardStep);
  }

  async function createRoom() {
    if (loading) return;

    if (!title.trim()) {
      alert("Enter a room name");
      setCurrentStep(0);
      return;
    }

    setLoading(true);

    try {
      const supabase = createSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
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
        const { error: uploadError } = await supabase.storage.from("event-images").upload(filePath, coverFile);

        if (uploadError) {
          alert(uploadError.message);
          setLoading(false);
          return;
        }

        const { data: publicUrlData } = supabase.storage.from("event-images").getPublicUrl(filePath);
        coverImage = publicUrlData.publicUrl;
      }

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
          series_id: seriesId || null,
        })
        .select("id")
        .single();

      if (roomError || !insertedRoom?.id) {
        alert(roomError?.message || "Room could not be created.");
        setLoading(false);
        return;
      }

      const { error: attendeeError } = await supabase.from("event_attendees").upsert(
        {
          event_room_id: insertedRoom.id,
          user_id: user.id,
          username: user.user_metadata?.full_name || user.user_metadata?.name || "Host",
          avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || "",
          status: "accepted",
          can_stream: true,
          stream_status: "off",
        },
        {
          onConflict: "event_room_id,user_id",
        },
      );

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
      setSeriesId("");
      setCurrentStep(0);
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

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/75 px-4 py-8">
            <div className="flex h-[min(760px,calc(100vh-4rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#12051e] text-white shadow-2xl shadow-purple-950/50">
              <div className="border-b border-white/10 p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-purple-300">PartyUp</p>
                    <h2 className="text-2xl font-black">Open a Room</h2>
                  </div>

                  <button
                    onClick={closeCreateRoom}
                    className="rounded-md border border-white/15 px-3 py-2 text-sm font-black hover:bg-white/10"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-5 grid grid-cols-4 gap-2">
                  {WIZARD_STEPS.map((step, index) => (
                    <button
                      key={step}
                      type="button"
                      onClick={() => setCurrentStep(index as WizardStep)}
                      className={`h-2 rounded-full transition ${index <= currentStep ? "bg-[#9146ff]" : "bg-white/12"}`}
                      aria-label={`Go to ${step}`}
                    />
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs font-black uppercase tracking-[0.16em] text-zinc-500">
                  <span>{WIZARD_STEPS[currentStep]}</span>
                  <span>
                    {currentStep + 1} / {WIZARD_STEPS.length}
                  </span>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                <div
                  className="flex h-full transition-transform duration-300 ease-out"
                  style={{ transform: `translateX(-${currentStep * 100}%)` }}
                >
                  <section className="flex h-full w-full shrink-0 flex-col gap-5 p-5">
                    <div>
                      <h3 className="text-xl font-black">Room basics</h3>
                      <p className="mt-1 text-sm font-bold text-zinc-500">Name the room and set the format.</p>
                    </div>

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
                  </section>

                  <section className="flex h-full w-full shrink-0 flex-col gap-4 p-5">
                    <div>
                      <h3 className="text-xl font-black">When is it happening?</h3>
                      <p className="mt-1 text-sm font-bold text-zinc-500">
                        Open now by default, or schedule it with the calendar.
                      </p>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/35 p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <span className="block text-sm font-black">When</span>
                          <span className="text-xs font-bold text-zinc-500">
                            {roomStatus === "live" ? "Start immediately" : scheduledLabel}
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

                      {roomStatus === "scheduled" ? (
                        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
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
                          </div>

                          <div className="rounded-lg border border-purple-400/15 bg-[#160824] p-3">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <p className="text-xs font-black uppercase tracking-[0.16em] text-purple-300">Time</p>
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
                      ) : (
                        <div className="rounded-lg border border-emerald-300/15 bg-emerald-950/20 p-4">
                          <p className="text-sm font-black text-emerald-200">
                            This room opens as soon as you create it.
                          </p>
                          <p className="mt-1 text-sm font-bold text-emerald-100/70">
                            Perfect for rooms that are already happening.
                          </p>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="flex h-full w-full shrink-0 flex-col gap-5 p-5">
                    <div>
                      <h3 className="text-xl font-black">Room details</h3>
                      <p className="mt-1 text-sm font-bold text-zinc-500">
                        Set capacity, location, cover, and visibility.
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-sm font-black">Max users</span>
                        <input
                          value={maxUsers}
                          onChange={(event) => setMaxUsers(event.target.value)}
                          inputMode="numeric"
                          className="w-full rounded-md bg-black px-3 py-3 text-white outline-none"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-sm font-black">Venue name</span>
                        <input
                          value={venueName}
                          onChange={(event) => setVenueName(event.target.value)}
                          placeholder="Optional"
                          className="w-full rounded-md bg-black px-3 py-3 text-white outline-none placeholder:text-zinc-500"
                        />
                      </label>
                    </div>

                    <label className="block">
                      <span className="mb-1 block text-sm font-black">Cover Image</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => setCoverFile(event.target.files?.[0] ?? null)}
                        className="w-full rounded-md bg-black px-3 py-3 text-white"
                      />
                    </label>

                    <div className="rounded-md border border-white/10 bg-black/40 p-3">
                      <label htmlFor="event-series" className="block text-sm font-black">Add to Event Series</label>
                      <select id="event-series" value={seriesId} onChange={(event) => setSeriesId(event.target.value)} className="mt-2 h-11 w-full rounded-md border border-white/10 bg-[#15131d] px-3 text-sm font-bold text-white outline-none focus:border-[#9b5cff]">
                        <option value="">One-off event</option>
                        {series.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                      <Link href="/series/new" className="mt-2 inline-block text-xs font-black text-[#c99cff] hover:text-white">Create a new series</Link>
                    </div>

                    <label className="flex items-center justify-between rounded-md bg-black/40 px-3 py-3">
                      <span>
                        <span className="block text-sm font-black">Private room</span>
                        <span className="text-xs text-zinc-500">Hide from public browsing later.</span>
                      </span>

                      <input
                        type="checkbox"
                        checked={isPrivateRoom}
                        onChange={(event) => setIsPrivateRoom(event.target.checked)}
                        className="h-5 w-5"
                      />
                    </label>
                  </section>

                  <section className="flex h-full w-full shrink-0 flex-col gap-3 p-4">
                    <div>
                      <h3 className="text-xl font-black">Review</h3>
                      <p className="text-sm font-bold text-zinc-500">
                        Make sure everything looks right before opening.
                      </p>
                    </div>

                    <div className="grid gap-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-white/10 bg-black/35 p-3">
                          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-purple-300">Room</p>
                          <p className="mt-1 truncate text-base font-black">{title.trim() || "Untitled room"}</p>
                          <p className="mt-0.5 text-xs font-bold text-zinc-500">
                            {roomType} / {roomMode}
                          </p>
                        </div>

                        <div className="rounded-lg border border-white/10 bg-black/35 p-3">
                          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-purple-300">When</p>
                          <p className="mt-1 text-base font-black">{roomStatus === "live" ? "Live now" : scheduledLabel}</p>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-white/10 bg-black/35 p-3">
                          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-purple-300">Capacity</p>
                          <p className="mt-1 text-base font-black">{Number(maxUsers) || 12} people</p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-black/35 p-3">
                          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-purple-300">Privacy</p>
                          <p className="mt-1 text-base font-black">{isPrivateRoom ? "Private" : "Public"}</p>
                        </div>
                      </div>

                      <div className="rounded-lg border border-white/10 bg-black/35 p-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-purple-300">Venue</p>
                        <p className="mt-1 truncate text-base font-black">{venueName.trim() || "Not set"}</p>
                        <p className="mt-0.5 truncate text-xs font-bold text-zinc-500">
                          {coverFile ? coverFile.name : "No cover image selected"}
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-white/10 p-5">
                <button
                  type="button"
                  onClick={currentStep === 0 ? closeCreateRoom : goToPreviousStep}
                  className="rounded-md border border-white/15 px-4 py-3 text-sm font-black text-zinc-200 hover:bg-white/10"
                >
                  {currentStep === 0 ? "Cancel" : "Back"}
                </button>

                {currentStep < 3 ? (
                  <button
                    type="button"
                    onClick={goToNextStep}
                    className="rounded-md bg-[#9146ff] px-5 py-3 text-sm font-black text-white hover:bg-[#7b31e8]"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={createRoom}
                    disabled={loading}
                    className="rounded-md bg-[#9146ff] px-5 py-3 text-sm font-black text-white hover:bg-[#7b31e8] disabled:opacity-50"
                  >
                    {loading ? "Creating..." : roomStatus === "scheduled" ? "Schedule Room" : "Open Room"}
                  </button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
