"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { createSupabaseClient } from "@/lib/supabase";
import MatchControls from "./components/MatchControls";

type MatchLiveKitTokenResponse = {
  token?: string;
  roomName?: string;
  participantIdentity?: string;
};

type MatchLiveKitStatus =
  | "requesting-token"
  | "connecting"
  | "connected"
  | "permission-warning"
  | "error"
  | "disconnected";

type MatchLiveKitProps = {
  sessionId: string;
  onReturnToMatch: () => void;
};

async function getFunctionErrorMessage(error: Error, response?: Response) {
  if (response) {
    try {
      const body = await response.clone().json();
      const message = typeof body?.error === "string" ? body.error : error.message;

      return `${response.status}: ${message}`;
    } catch {
      return `${response.status}: ${error.message}`;
    }
  }

  return error.message || "Could not request Match video access.";
}

export default function MatchLiveKit({ sessionId, onReturnToMatch }: MatchLiveKitProps) {
  const [token, setToken] = useState<string | null>(null);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [participantIdentity, setParticipantIdentity] = useState<string | null>(null);
  const [status, setStatus] = useState<MatchLiveKitStatus>("requesting-token");
  const [message, setMessage] = useState<string | null>(null);
  const supabase = useMemo(() => createSupabaseClient(), []);
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  useEffect(() => {
    let cancelled = false;

    async function requestToken() {
      if (!livekitUrl) {
        setStatus("error");
        setMessage("Missing LiveKit URL.");
        return;
      }

      setStatus("requesting-token");
      setMessage(null);
      setToken(null);
      setRoomName(null);
      setParticipantIdentity(null);

      const { data, error, response } = await supabase.functions.invoke<MatchLiveKitTokenResponse>(
        "match-livekit-token",
        {
          body: {
            matchSessionId: sessionId,
          },
        },
      );

      if (cancelled) {
        return;
      }

      if (error) {
        setStatus("error");
        setMessage(await getFunctionErrorMessage(error, response));
        return;
      }

      if (!data?.token || !data.roomName || !data.participantIdentity) {
        setStatus("error");
        setMessage("Match video access returned an incomplete response.");
        return;
      }

      setToken(data.token);
      setRoomName(data.roomName);
      setParticipantIdentity(data.participantIdentity);
      setStatus("connecting");
    }

    requestToken();

    return () => {
      cancelled = true;
    };
  }, [livekitUrl, sessionId, supabase]);

  if (status === "error" || status === "disconnected") {
    return (
      <MatchLiveKitMessage
        title={status === "disconnected" ? "Disconnected" : "Could not connect"}
        message={message ?? "The Match video room is no longer connected."}
        onReturnToMatch={onReturnToMatch}
      />
    );
  }

  if (!livekitUrl || !token) {
    return (
      <MatchLiveKitMessage
        title={status === "requesting-token" ? "Matched" : "Connecting"}
        message={
          status === "requesting-token"
            ? "Requesting secure video access..."
            : "Connecting to your Match..."
        }
      />
    );
  }

  return (
    <LiveKitRoom
      serverUrl={livekitUrl}
      token={token}
      connect={true}
      audio={false}
      video={false}
      onConnected={() => {
        setStatus("connected");
        setMessage(null);
      }}
      onDisconnected={() => {
        setStatus("disconnected");
        setMessage("You left the Match video room.");
      }}
      onError={(error) => {
        setStatus("error");
        setMessage(error.message || "LiveKit connection failed.");
      }}
      onMediaDeviceFailure={(_failure, kind) => {
        setStatus("permission-warning");
        setMessage(
          kind === "audioinput"
            ? "Microphone permission was denied. You can still use camera if available."
            : "Camera permission was denied. You can still use microphone if available.",
        );
      }}
    >
      <MatchRoomView
        participantIdentity={participantIdentity}
        roomName={roomName}
        sessionId={sessionId}
        status={status}
        message={message}
      />
    </LiveKitRoom>
  );
}

function MatchRoomView({
  participantIdentity,
  roomName,
  sessionId,
  status,
  message,
}: {
  participantIdentity: string | null;
  roomName: string | null;
  sessionId: string;
  status: MatchLiveKitStatus;
  message: string | null;
}) {
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const room = useRoomContext();
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [mediaMessage, setMediaMessage] = useState<string | null>(null);

  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  );

  const remoteParticipant = participants.find(
    (participant) => participant.identity !== localParticipant.identity,
  );
  const remoteTrack = tracks.find(
    (trackRef) => trackRef.participant.identity !== localParticipant.identity,
  );
  const localTrack = tracks.find(
    (trackRef) => trackRef.participant.identity === localParticipant.identity,
  );

  useEffect(() => {
    let cancelled = false;

    async function enableLocalMedia() {
      try {
        await localParticipant.setCameraEnabled(true);
        if (!cancelled) {
          setCameraEnabled(true);
        }
      } catch {
        if (!cancelled) {
          setCameraEnabled(false);
          setMediaMessage("Camera permission was denied.");
        }
      }

      try {
        await localParticipant.setMicrophoneEnabled(true);
        if (!cancelled) {
          setMicrophoneEnabled(true);
        }
      } catch {
        if (!cancelled) {
          setMicrophoneEnabled(false);
          setMediaMessage((current) =>
            current
              ? `${current} Microphone permission was denied.`
              : "Microphone permission was denied.",
          );
        }
      }
    }

    enableLocalMedia();

    return () => {
      cancelled = true;
      void localParticipant.setCameraEnabled(false);
      void localParticipant.setMicrophoneEnabled(false);
    };
  }, [localParticipant]);

  async function toggleMicrophone() {
    const next = !microphoneEnabled;

    try {
      await localParticipant.setMicrophoneEnabled(next);
      setMicrophoneEnabled(next);
      setMediaMessage(null);
    } catch {
      setMicrophoneEnabled(false);
      setMediaMessage("Microphone permission was denied.");
    }
  }

  async function toggleCamera() {
    const next = !cameraEnabled;

    try {
      await localParticipant.setCameraEnabled(next);
      setCameraEnabled(next);
      setMediaMessage(null);
    } catch {
      setCameraEnabled(false);
      setMediaMessage("Camera permission was denied.");
    }
  }

  return (
    <div className="relative h-[80vh] w-full overflow-hidden rounded-lg bg-black">
      <RoomAudioRenderer />

      <div className="h-full w-full">
        {remoteTrack ? (
          <div className="relative h-full w-full [&_.lk-participant-name]:hidden [&_.lk-participant-tile]:h-full [&_.lk-participant-tile]:w-full [&_[data-lk-participant-name]]:hidden [&_video]:h-full [&_video]:w-full [&_video]:object-contain">
            <ParticipantTile trackRef={remoteTrack} />
            <div className="absolute left-4 bottom-24 rounded-md bg-black/55 px-3 py-2 text-sm font-black text-white backdrop-blur">
              Your Match
            </div>
          </div>
        ) : (
          <div className="grid h-full w-full place-items-center bg-[#08000f]">
            <div className="text-center">
              <p className="text-2xl font-black text-white">
                {remoteParticipant ? "Your Match" : "Waiting for your Match"}
              </p>
              <p className="mt-2 text-sm font-bold text-zinc-400">
                {remoteParticipant ? "Camera off" : "Connecting..."}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="absolute right-4 top-4 h-28 w-40 overflow-hidden rounded-lg border border-white/15 bg-[#10051c] shadow-2xl [&_.lk-participant-name]:hidden [&_.lk-participant-tile]:h-full [&_.lk-participant-tile]:w-full [&_[data-lk-participant-name]]:hidden [&_video]:h-full [&_video]:w-full [&_video]:object-cover">
        {localTrack ? (
          <div className="relative h-full w-full">
            <ParticipantTile trackRef={localTrack} />
            <div className="absolute bottom-2 left-2 rounded bg-black/55 px-2 py-1 text-xs font-black text-white">
              You
            </div>
          </div>
        ) : (
          <div className="grid h-full w-full place-items-center text-sm font-bold text-zinc-400">
            You
          </div>
        )}
      </div>

      <div className="absolute left-4 top-4 max-w-[20rem] rounded-md border border-emerald-300/20 bg-black/60 px-4 py-3 backdrop-blur">
        <p className="text-sm font-black uppercase tracking-[0.14em] text-emerald-200">
          {status === "connected" || status === "permission-warning" ? "Matched" : "Connecting"}
        </p>
        <p className="mt-1 truncate text-xs text-zinc-400">Session: {sessionId}</p>
        {roomName && <p className="mt-1 truncate text-xs text-zinc-500">Room: {roomName}</p>}
        {participantIdentity && (
          <p className="mt-1 text-xs text-zinc-500">Secure participant ready</p>
        )}
      </div>

      {(message || mediaMessage) && (
        <div className="absolute left-1/2 top-4 max-w-md -translate-x-1/2 rounded-md border border-amber-300/20 bg-amber-950/70 px-4 py-3 text-sm font-bold text-amber-100 backdrop-blur">
          {mediaMessage ?? message}
        </div>
      )}

      <div className="absolute bottom-6 left-0 right-0 flex justify-center px-4">
        <div className="w-full max-w-3xl">
          <MatchControls
            cameraEnabled={cameraEnabled}
            microphoneEnabled={microphoneEnabled}
            onCameraToggle={toggleCamera}
            onMicrophoneToggle={toggleMicrophone}
            onLeave={() => room.disconnect()}
          />
        </div>
      </div>
    </div>
  );
}

function MatchLiveKitMessage({
  title,
  message,
  onReturnToMatch,
}: {
  title: string;
  message: string;
  onReturnToMatch?: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="rounded-xl bg-gradient-to-br from-[#0b0410]/80 via-[#12051e]/60 to-[#0b0410]/80 p-8 text-center">
        <h2 className="text-2xl font-extrabold">{title}</h2>
        <p className="mt-3 text-sm text-zinc-300">{message}</p>
        {onReturnToMatch && (
          <button
            onClick={onReturnToMatch}
            className="mt-6 rounded-full bg-pink-500 px-5 py-2 font-black text-white hover:bg-pink-600"
          >
            Return to Match
          </button>
        )}
      </div>
    </div>
  );
}
