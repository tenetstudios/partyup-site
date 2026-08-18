"use client";

import type React from "react";
import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  ParticipantTile,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { createSupabaseClient } from "@/lib/supabase";

export default function WebLiveKitRoom({ roomId }: { roomId: string }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [shouldConnect, setShouldConnect] = useState(false);
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  function resetConnection() {
    setShouldConnect(false);
    setToken("");
    setError("");
  }

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
      <PlayerFrame viewerCount={0}>
        <StreamEmptyState onJoin={() => setShouldConnect(true)} />
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
      <CustomStreamView onLeave={resetConnection} />
    </LiveKitRoom>
  );
}

function CustomStreamView({ onLeave }: { onLeave: () => void }) {
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
    <PlayerFrame viewerCount={viewerCount}>
      {selectedTrack ? (
        <div className="grid h-full w-full place-items-center bg-black">
          <div className="h-full max-h-[620px] w-full max-w-[1100px] overflow-hidden bg-black [&_.lk-participant-tile]:h-full [&_.lk-participant-tile]:w-full [&_video]:h-full [&_video]:w-full [&_video]:object-contain">
            <ParticipantTile trackRef={selectedTrack} />
          </div>
        </div>
      ) : (
        <WaitingForLiveState />
      )}

      {videoTracks.length > 1 && (
        <div className="absolute bottom-16 left-0 right-0 z-20 flex gap-3 overflow-x-auto border-t border-white/10 bg-[#0a0010]/90 p-3">
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

      <CustomControls onLeave={onLeave} />
    </PlayerFrame>
  );
}

function PlayerFrame({
  children,
  viewerCount,
}: {
  children: React.ReactNode;
  viewerCount: number;
}) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-[radial-gradient(circle_at_70%_74%,rgba(95,42,174,0.18),transparent_30%),#050409]">
      <div className="absolute left-5 top-5 z-30 flex items-center gap-3">
        <span className="rounded-[6px] bg-[#ef2f82] px-4 py-2 text-sm font-black uppercase leading-none text-white">
          Live
        </span>
        <span className="rounded-[6px] border border-white/20 bg-black/55 px-4 py-2 text-sm font-black leading-none text-white backdrop-blur">
          {viewerCount} viewers
        </span>
      </div>

      {children}

      <div className="absolute bottom-5 left-5 z-30 flex items-center gap-5 text-white">
        <button className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10" aria-label="Play livestream">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7-11-7Z" />
          </svg>
        </button>
        <button className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10" aria-label="Livestream volume">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4Z" />
            <path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
        </button>
      </div>

      <button
        onClick={() => {
          if (document.fullscreenElement) {
            document.exitFullscreen();
            return;
          }

          document.documentElement.requestFullscreen();
        }}
        className="absolute bottom-5 right-5 z-30 grid h-8 w-8 place-items-center rounded-full text-white hover:bg-white/10"
        aria-label="Fullscreen livestream"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" aria-hidden="true">
          <path d="M8 3H3v5M21 8V3h-5M16 21h5v-5M3 16v5h5" />
        </svg>
      </button>
    </div>
  );
}

function StreamEmptyState({ onJoin }: { onJoin: () => void }) {
  return (
    <div className="grid h-full w-full place-items-center px-6 text-center">
      <div>
        <StreamIcon />
        <h2 className="mt-5 text-[24px] font-black leading-tight text-white">
          Waiting for someone to go live...
        </h2>
        <p className="mt-3 text-[18px] leading-7 text-[#aaa4b8]">
          Be the first to go live in this room.
        </p>
        <button
          onClick={onJoin}
          className="mt-8 rounded-[6px] bg-[#9146ff] px-7 py-4 text-base font-black text-white shadow-[0_14px_34px_rgba(145,70,255,0.24)] hover:bg-[#7b31e8]"
        >
          Join Livestream
        </button>
      </div>
    </div>
  );
}

function WaitingForLiveState() {
  return (
    <div className="grid h-full w-full place-items-center px-6 text-center">
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

function CustomControls({ onLeave }: { onLeave: () => void }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [obsOn, setObsOn] = useState(false);

  async function toggleMic() {
    const next = !micOn;
    await localParticipant.setMicrophoneEnabled(next);
    setMicOn(next);
  }

  async function toggleCam() {
    const next = !camOn;
    await localParticipant.setCameraEnabled(next);
    setCamOn(next);
    if (!next) setObsOn(false);
  }

  function leaveRoom() {
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

    setCamOn(true);
    setObsOn(true);
  }

  return (
    <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-black/75 p-2 shadow-2xl backdrop-blur">
      <ControlButton
        label={micOn ? "Mute Microphone" : "Unmute Microphone"}
        active={micOn}
        onClick={toggleMic}
      >
        {micOn ? <MicOnIcon /> : <MicOffIcon />}
      </ControlButton>

      <ControlButton
        label={camOn ? "End Live" : "Go Live"}
        active={camOn}
        intent={camOn ? "danger" : "default"}
        onClick={toggleCam}
      >
        {camOn ? <VideoOffIcon /> : <VideoOnIcon />}
      </ControlButton>

      <ControlButton
        label={obsOn ? "OBS Camera On" : "Use OBS Camera"}
        active={obsOn}
        onClick={useObsVirtualCamera}
      >
        <ObsIcon />
      </ControlButton>

      <ControlButton label="Leave" intent="danger" onClick={leaveRoom}>
        <LeaveIcon />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  active = false,
  children,
  intent = "default",
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  intent?: "default" | "danger";
  label: string;
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
    <div className="group relative grid h-11 w-11 shrink-0 place-items-center">
      <button
        onClick={onClick}
        className={`grid h-11 w-11 place-items-center rounded-full transition ${className}`}
        aria-label={label}
        title={label}
      >
        {children}
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

function StreamMessage({ text }: { text: string }) {
  return (
    <PlayerFrame viewerCount={0}>
      <div className="grid h-full w-full place-items-center px-6 text-center text-sm font-bold text-zinc-400">
        {text}
      </div>
    </PlayerFrame>
  );
}
