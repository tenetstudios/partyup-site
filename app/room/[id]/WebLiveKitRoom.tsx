"use client";

import type React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  LiveKitRoom,
  ParticipantTile,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { getRoomIdleMedia, type RoomIdleMedia } from "@/lib/roomIdleMedia";
import { createSupabaseClient } from "@/lib/supabase";

type RoomLiveState = {
  is_live: boolean;
  signal_authoritative: boolean;
};

const subscribeToClientEnvironment = () => () => undefined;

export default function WebLiveKitRoom({ roomId }: { roomId: string }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [shouldConnect, setShouldConnect] = useState(false);
  const [publisherIntent, setPublisherIntent] = useState(false);
  const [canInitiateStream, setCanInitiateStream] = useState(false);
  const [idleMedia, setIdleMedia] = useState<RoomIdleMedia | null>(null);
  const [liveState, setLiveState] = useState<RoomLiveState | null>(null);
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  function resetConnection() {
    setShouldConnect(false);
    setToken("");
    setError("");
  }

  useEffect(() => {
    const supabase = createSupabaseClient();

    async function loadFrameState() {
      const [{ data: userData }, { data: nextLiveState }] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("room_live_state")
          .select("is_live,signal_authoritative")
          .eq("room_id", roomId)
          .maybeSingle(),
      ]);

      setLiveState((nextLiveState as RoomLiveState | null) ?? null);
      setIdleMedia(await getRoomIdleMedia(supabase, roomId).catch(() => null));

      const user = userData.user;
      if (!user) {
        setCanInitiateStream(false);
        return;
      }

      const [{ data: room }, { data: attendee }] = await Promise.all([
        supabase.from("event_rooms").select("host_id").eq("id", roomId).maybeSingle(),
        supabase
          .from("event_attendees")
          .select("can_stream,status")
          .eq("event_room_id", roomId)
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      setCanInitiateStream(
        room?.host_id === user.id ||
          (attendee?.status === "accepted" && attendee?.can_stream === true),
      );
    }

    queueMicrotask(() => void loadFrameState());

    const channel = supabase
      .channel(`room-stream-frame-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_idle_media", filter: `room_id=eq.${roomId}` },
        () => void loadFrameState(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_live_state", filter: `room_id=eq.${roomId}` },
        (payload) => {
          const row = payload.new as RoomLiveState;
          setLiveState(row);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_attendees", filter: `event_room_id=eq.${roomId}` },
        () => void loadFrameState(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  useEffect(() => {
    if (!liveState?.signal_authoritative) return;

    queueMicrotask(() => {
      if (liveState.is_live) {
        setShouldConnect(true);
      } else if (!publisherIntent) {
        resetConnection();
      }
    });
  }, [liveState, publisherIntent]);

  useEffect(() => {
    if (!shouldConnect) return;

    async function getToken() {
      const supabase = createSupabaseClient();
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;

      if (!user) {
        setError("Sign in first to join the livestream.");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();

      const displayName = profile?.username || `Guest ${user.id.slice(0, 4)}`;

      const { data, error: tokenError } = await supabase.functions.invoke("livekit-token", {
        body: {
          roomName: roomId,
          participantName: displayName,
          canPublish: true,
        },
      });

      if (tokenError) {
        setError(tokenError.message);
        return;
      }

      setToken(data.token);
    }

    getToken();
  }, [roomId, shouldConnect]);

  if (!shouldConnect) {
    return (
      <PlayerFrame mode={idleMedia?.enabled ? "idle" : "empty"} viewerCount={0}>
        {idleMedia?.enabled ? (
          <IdleLoopState
            media={idleMedia}
            actionLabel={canInitiateStream ? "Go Live" : liveState?.signal_authoritative ? null : "Join Livestream"}
            onAction={() => {
              setPublisherIntent(canInitiateStream);
              setShouldConnect(true);
            }}
          />
        ) : (
          <StreamEmptyState
            actionLabel={canInitiateStream ? "Go Live" : liveState?.signal_authoritative ? null : "Join Livestream"}
            onJoin={() => {
              setPublisherIntent(canInitiateStream);
              setShouldConnect(true);
            }}
          />
        )}
      </PlayerFrame>
    );
  }

  if (!livekitUrl) return <StreamMessage text="Missing LiveKit URL." />;
  if (error) return <StreamMessage text={error} />;
  if (!token) return <StreamMessage text="Connecting to livestream..." />;

  return (
    <LiveKitRoom
      serverUrl={livekitUrl}
      token={token}
      connect={true}
      audio={false}
      video={false}
      onDisconnected={resetConnection}
    >
      <CustomStreamView
        canInitiateStream={canInitiateStream}
        expectedLive={Boolean(liveState?.is_live)}
        idleMedia={idleMedia?.enabled ? idleMedia : null}
        onLeave={() => {
          setPublisherIntent(false);
          resetConnection();
        }}
        onPublishingChange={(publishing) => {
          setPublisherIntent(publishing);
          if (!publishing && liveState?.signal_authoritative && !liveState.is_live) resetConnection();
        }}
        roomId={roomId}
      />
    </LiveKitRoom>
  );
}

function CustomStreamView({
  canInitiateStream,
  expectedLive,
  idleMedia,
  onLeave,
  onPublishingChange,
  roomId,
}: {
  canInitiateStream: boolean;
  expectedLive: boolean;
  idleMedia: RoomIdleMedia | null;
  onLeave: () => void;
  onPublishingChange: (publishing: boolean) => void;
  roomId: string;
}) {
  const participants = useParticipants();
  const viewerCount = participants.length;
  const [selectedTrackKey, setSelectedTrackKey] = useState<string | null>(null);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: false },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const videoTracks = tracks.filter((trackRef) => {
    return trackRef.publication?.track && !trackRef.publication.isMuted;
  });

  function getTrackKey(trackRef: (typeof videoTracks)[number]) {
    return `${trackRef.participant.identity}-${trackRef.source}`;
  }

  const selectedTrack =
    videoTracks.find((trackRef) => getTrackKey(trackRef) === selectedTrackKey) ||
    videoTracks[0];

  return (
    <PlayerFrame mode={selectedTrack ? "live" : idleMedia ? "idle" : "connecting"} viewerCount={viewerCount}>
      {selectedTrack ? (
        <div className="grid h-full w-full animate-[room-frame-fade_220ms_ease-out] place-items-center bg-black">
          <div className="h-full max-h-[620px] w-full max-w-[1100px] overflow-hidden bg-black [&_.lk-participant-tile]:h-full [&_.lk-participant-tile]:w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain">
            <ParticipantTile trackRef={selectedTrack} />
          </div>
        </div>
      ) : expectedLive ? (
        <ConnectingLiveState />
      ) : idleMedia ? (
        <IdleLoopState media={idleMedia} actionLabel={null} onAction={() => undefined} />
      ) : (
        <WaitingForLiveState />
      )}

      {videoTracks.length > 1 && (
        <div className="absolute bottom-20 left-0 right-0 z-20 flex gap-3 overflow-x-auto border-t border-white/10 bg-[#0a0010]/90 p-3">
          {videoTracks.map((trackRef) => {
            const key = getTrackKey(trackRef);
            const isSelected = selectedTrack ? key === getTrackKey(selectedTrack) : false;

            return (
              <button
                key={key}
                onClick={() => setSelectedTrackKey(key)}
                className={`h-24 w-36 shrink-0 overflow-hidden rounded-[8px] border bg-black ${
                  isSelected
                    ? "border-purple-400"
                    : "border-white/15 opacity-80 hover:opacity-100"
                }`}
              >
                <div className="h-full w-full [&_.lk-participant-tile]:h-full [&_.lk-participant-tile]:w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover">
                  <ParticipantTile trackRef={trackRef} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <CustomControls
        canInitiateStream={canInitiateStream}
        liveFeedActive={Boolean(selectedTrack)}
        onLeave={onLeave}
        onPublishingChange={onPublishingChange}
        roomId={roomId}
      />
    </PlayerFrame>
  );
}

function PlayerFrame({
  children,
  mode,
  viewerCount,
}: {
  children: React.ReactNode;
  mode: "live" | "idle" | "empty" | "connecting";
  viewerCount: number;
}) {
  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_70%_74%,rgba(95,42,174,0.18),transparent_30%),#050409]"
    >
      {mode === "live" && (
        <div className="absolute left-5 top-5 z-30 flex items-center gap-3">
          <span className="rounded-[6px] bg-[#ef2f82] px-4 py-2 text-sm font-black uppercase leading-none text-white">Live</span>
          <span className="rounded-[6px] border border-white/20 bg-black/55 px-4 py-2 text-sm font-black leading-none text-white backdrop-blur">{viewerCount} viewers</span>
        </div>
      )}

      {children}

      {mode === "live" && <button
        onClick={() => {
          if (document.fullscreenElement) {
            document.exitFullscreen();
            return;
          }

          document.documentElement.requestFullscreen();
        }}
        className="absolute right-5 top-5 z-50 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/60 text-white backdrop-blur hover:bg-black/80"
        aria-label="Fullscreen livestream"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" aria-hidden="true">
          <path d="M8 3H3v5M21 8V3h-5M16 21h5v-5M3 16v5h5" />
        </svg>
      </button>}
    </div>
  );
}

function StreamEmptyState({ actionLabel, onJoin }: { actionLabel: string | null; onJoin: () => void }) {
  return (
    <div className="grid h-full w-full animate-[room-frame-fade_220ms_ease-out] place-items-center px-6 text-center">
      <div>
        <StreamIcon />
        <h2 className="mt-5 text-[24px] font-black leading-tight text-white">
          Waiting for someone to go live...
        </h2>
        <p className="mt-3 text-[18px] leading-7 text-[#aaa4b8]">
          Be the first to go live in this room.
        </p>
        {actionLabel && (
          <button onClick={onJoin} className="mt-8 rounded-[6px] bg-[#9146ff] px-7 py-4 text-base font-black text-white shadow-[0_14px_34px_rgba(145,70,255,0.24)] hover:bg-[#7b31e8]">
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function WaitingForLiveState() {
  return (
    <div className="grid h-full w-full animate-[room-frame-fade_220ms_ease-out] place-items-center px-6 text-center">
      <div>
        <StreamIcon />
        <h2 className="mt-5 text-[24px] font-black leading-tight text-white">
          Waiting for someone to go live...
        </h2>
        <p className="mt-3 text-[18px] leading-7 text-[#aaa4b8]">
          Be the first to go live in this room.
        </p>
      </div>
    </div>
  );
}

function ConnectingLiveState() {
  return (
    <div className="grid h-full w-full animate-[room-frame-fade_220ms_ease-out] place-items-center px-6 text-center">
      <div>
        <StreamIcon />
        <h2 className="mt-5 text-[24px] font-black text-white">Connecting live stream...</h2>
      </div>
    </div>
  );
}

function IdleLoopState({
  actionLabel,
  media,
  onAction,
}: {
  actionLabel: string | null;
  media: RoomIdleMedia;
  onAction: () => void;
}) {
  return (
    <div className="relative h-full w-full animate-[room-frame-fade_220ms_ease-out] bg-black">
      {media.media_type === "video" ? (
        <video src={media.signed_url} autoPlay loop muted playsInline className="h-full w-full object-cover" />
      ) : (
        // A normal img preserves GIF animation without routing it through an image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={media.signed_url} alt="Venue highlights" className="h-full w-full object-cover" />
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/20" />
      <span className="absolute left-5 top-5 rounded-[6px] border border-white/20 bg-black/60 px-3 py-2 text-xs font-black tracking-[0.12em] text-white backdrop-blur">HIGHLIGHTS</span>
      {actionLabel && (
        <button type="button" onClick={onAction} className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-[6px] bg-[#9146ff] px-5 py-3 text-sm font-black text-white shadow-xl hover:bg-[#7b31e8]">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function StreamIcon() {
  return (
    <div className="mx-auto grid h-14 w-14 place-items-center rounded-[6px] border-2 border-[#7f3dff] text-[#7f3dff]">
      <svg viewBox="0 0 32 32" className="h-9 w-9" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" aria-hidden="true">
        <rect x="5" y="8" width="22" height="14" rx="2" />
        <path d="M12 26h8M16 22v4M12 17a4 4 0 0 1 8 0M9 17a7 7 0 0 1 14 0M15 17h2" />
      </svg>
    </div>
  );
}

function CustomControls({
  canInitiateStream,
  liveFeedActive,
  onLeave,
  onPublishingChange,
  roomId,
}: {
  canInitiateStream: boolean;
  liveFeedActive: boolean;
  onLeave: () => void;
  onPublishingChange: (publishing: boolean) => void;
  roomId: string;
}) {
  const room = useRoomContext();
  const {
    isCameraEnabled,
    isMicrophoneEnabled,
    localParticipant,
  } = useLocalParticipant();

  const [obsOn, setObsOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveMenuOpen, setLiveMenuOpen] = useState(false);
  const portalReady = useSyncExternalStore(
    subscribeToClientEnvironment,
    () => true,
    () => false,
  );

  const isPublishing = isCameraEnabled || isMicrophoneEnabled || obsOn;
  const showBroadcastControls = canInitiateStream || isPublishing;

  async function toggleMic() {
    const next = !isMicrophoneEnabled;
    await localParticipant.setMicrophoneEnabled(next);
  }

  async function toggleCam() {
    const next = !isCameraEnabled;
    await localParticipant.setCameraEnabled(next);
    await reportPublishing(next);
    if (!next) setObsOn(false);
  }

  async function endLive() {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all([
        localParticipant.setCameraEnabled(false),
        localParticipant.setMicrophoneEnabled(false),
      ]);
      setObsOn(false);
      await reportPublishing(false);
    } catch (error) {
      console.error("END LIVESTREAM ERROR", error);
      alert("Could not end the livestream. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function reportPublishing(publishing: boolean) {
    const supabase = createSupabaseClient();
    await supabase.rpc("report_room_live_publisher", {
      p_is_live: publishing,
      p_room_id: roomId,
    });
    onPublishingChange(publishing);
  }

  async function leaveRoom() {
    if (isPublishing) await reportPublishing(false);
    room.disconnect();
    onLeave();
  }

  async function useObsVirtualCamera() {
    const devices = await navigator.mediaDevices.enumerateDevices();

    const obsCamera = devices.find(
      (device) =>
        device.kind === "videoinput" &&
        device.label.toLowerCase().includes("obs"),
    );

    if (!obsCamera) {
      alert(
        "OBS Virtual Camera not found. Open OBS, click Start Virtual Camera, then refresh PartyUp.",
      );
      return;
    }

    await localParticipant.setCameraEnabled(false);

    await localParticipant.setCameraEnabled(true, {
      deviceId: obsCamera.deviceId,
    });

    setObsOn(true);
    await reportPublishing(true);
  }

  const controlButtons = (
    <>
      {isPublishing && (
        <button
          type="button"
          onClick={() => void endLive()}
          disabled={busy}
          className="flex h-12 shrink-0 items-center gap-2 rounded-full bg-red-600 px-4 font-black text-white shadow-lg shadow-red-950/40 transition hover:bg-red-500 disabled:opacity-60"
          aria-label="End livestream"
        >
          <EndLiveIcon />
          <span>{busy ? "Ending..." : "End Live"}</span>
        </button>
      )}

      {showBroadcastControls && <ControlButton
        label={isMicrophoneEnabled ? "Mute Microphone" : "Unmute Microphone"}
        shortLabel={isMicrophoneEnabled ? "Mute" : "Mic"}
        active={isMicrophoneEnabled}
        onClick={toggleMic}
      >
        {isMicrophoneEnabled ? <MicOnIcon /> : <MicOffIcon />}
      </ControlButton>}

      {showBroadcastControls && <ControlButton
        label={isCameraEnabled ? "Camera Off" : "Camera On"}
        shortLabel={isCameraEnabled ? "Cam Off" : "Camera"}
        active={isCameraEnabled}
        onClick={toggleCam}
      >
        {isCameraEnabled ? <VideoOffIcon /> : <VideoOnIcon />}
      </ControlButton>}

      {showBroadcastControls && <ControlButton
        label={obsOn ? "OBS Camera On" : "Use OBS Camera"}
        shortLabel="OBS"
        active={obsOn}
        onClick={useObsVirtualCamera}
      >
        <ObsIcon />
      </ControlButton>}

      <ControlButton label="Leave livestream player" shortLabel="Exit" intent="danger" onClick={() => void leaveRoom()}>
        <LeaveIcon />
      </ControlButton>
    </>
  );

  if (liveFeedActive && portalReady) {
    return createPortal(
      <div
        className="group fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-[2147483647] flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 touch-manipulation flex-col items-center"
        style={{ zIndex: 2147483647 }}
        onMouseEnter={() => setLiveMenuOpen(true)}
        onMouseLeave={() => setLiveMenuOpen(false)}
        onFocusCapture={() => setLiveMenuOpen(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setLiveMenuOpen(false);
          }
        }}
      >
        <div
          className={`mb-2 flex max-w-full items-center gap-2 overflow-x-auto rounded-2xl border border-white/20 bg-black/95 p-2 shadow-[0_18px_60px_rgba(0,0,0,0.7)] backdrop-blur-xl transition duration-150 sm:rounded-full ${
            liveMenuOpen
              ? "pointer-events-auto translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100"
          }`}
          aria-label="Active livestream controls"
        >
          {controlButtons}
        </div>

        <button
          type="button"
          onClick={() => setLiveMenuOpen((open) => !open)}
          className={`pointer-events-auto flex h-12 items-center gap-2 rounded-full border px-5 text-sm font-black text-white shadow-2xl backdrop-blur transition ${
            isPublishing
              ? "border-red-300/40 bg-red-600 hover:bg-red-500"
              : "border-purple-300/30 bg-[#6d28d9] hover:bg-[#7c3aed]"
          }`}
          aria-expanded={liveMenuOpen}
          aria-label={isPublishing ? "Open controls to end livestream" : "Open livestream controls"}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${isPublishing ? "animate-pulse bg-white" : "bg-purple-200"}`} />
          {isPublishing ? "End / Controls" : "Live Controls"}
        </button>
      </div>,
      document.body,
    );
  }

  return (
    <div
      className="absolute bottom-3 left-3 right-3 z-[999] flex touch-manipulation items-center justify-center gap-2 overflow-x-auto rounded-2xl border border-white/15 bg-black/90 p-2 shadow-2xl backdrop-blur sm:left-1/2 sm:right-auto sm:max-w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:rounded-full"
      style={{ zIndex: 999 }}
      aria-label="Livestream controls"
    >
      {controlButtons}
    </div>
  );
}

function ControlButton({
  active = false,
  children,
  intent = "default",
  label,
  shortLabel,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  intent?: "default" | "danger";
  label: string;
  shortLabel: string;
  onClick: () => void;
}) {
  const className =
    intent === "danger"
      ? active
        ? "bg-red-600 text-white hover:bg-red-500"
        : "bg-red-600/90 text-white hover:bg-red-500"
      : active
        ? "bg-white text-black hover:bg-zinc-200"
        : "bg-zinc-800 text-white hover:bg-zinc-700";

  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        onClick={onClick}
        className={`flex h-12 min-w-12 items-center justify-center gap-2 rounded-full px-3 transition ${className}`}
        aria-label={label}
        title={label}
      >
        {children}
        <span className="text-xs font-black sm:text-sm">{shortLabel}</span>
      </button>
      <span className="pointer-events-none absolute bottom-14 left-1/2 max-w-[140px] -translate-x-1/2 whitespace-nowrap rounded-[6px] border border-white/10 bg-black/90 px-3 py-1.5 text-xs font-black text-white opacity-0 shadow-xl transition group-focus-within:opacity-100 group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}

function MicOnIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" aria-hidden="true">
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" aria-hidden="true">
      <path d="m3 3 18 18" />
      <path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.1-2.1" />
      <path d="M5 10v2a7 7 0 0 0 11.7 5.2M19 10v2c0 1-.2 2-.6 2.9M12 19v3M8 22h8" />
    </svg>
  );
}

function VideoOnIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </svg>
  );
}

function VideoOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" aria-hidden="true">
      <path d="m3 3 18 18" />
      <path d="M10.6 6H14a2 2 0 0 1 2 2v3.4l5-3v7.2l-2.2-1.3" />
      <path d="M15.8 17.8A2 2 0 0 1 14 18H5a2 2 0 0 1-2-2V8a2 2 0 0 1 .2-.8" />
    </svg>
  );
}

function ObsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" aria-hidden="true">
      <path d="M7 7.5A5 5 0 0 1 16.3 5" />
      <path d="M17 16.5A5 5 0 0 1 7.7 19" />
      <path d="M5.5 9A5 5 0 0 0 8 18.3" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function LeaveIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" aria-hidden="true">
      <path d="M10 17 5 12l5-5" />
      <path d="M5 12h12" />
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
    </svg>
  );
}

function EndLiveIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function StreamMessage({ text }: { text: string }) {
  return (
    <PlayerFrame mode="connecting" viewerCount={0}>
      <div className="grid h-full w-full place-items-center px-6 text-center text-sm font-bold text-zinc-400">
        {text}
      </div>
    </PlayerFrame>
  );
}
