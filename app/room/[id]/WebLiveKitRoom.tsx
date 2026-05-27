"use client";

import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  ParticipantTile,
  useParticipants,
  useLocalParticipant,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { createSupabaseClient } from "@/lib/supabase";

export default function WebLiveKitRoom({ roomId }: { roomId: string }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  useEffect(() => {
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

      const { data, error } = await supabase.functions.invoke("livekit-token", {
        body: {
          roomName: roomId,
          participantName: displayName,
          canPublish: true,
        },
      });

      if (error) {
        setError(error.message);
        return;
      }

      setToken(data.token);
    }

    getToken();
  }, [roomId]);

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
    >
      <CustomStreamView />
    </LiveKitRoom>
  );
}

function CustomStreamView() {
  
    const participants = useParticipants();
    const viewerCount = participants.length;  
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

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
        <div className="absolute right-4 top-4 z-30 flex items-center gap-2 rounded-full bg-black/70 px-3 py-2 text-xs font-black text-white backdrop-blur">
  <span className="h-2 w-2 rounded-full bg-red-500" />
  LIVE
  <span className="text-zinc-300">•</span>
  <span>{viewerCount} watching</span>
</div>
      {videoTracks.length > 0 ? (
        <div className="h-full w-full">
          {videoTracks.map((trackRef) => (
            <div
              key={`${trackRef.participant.identity}-${trackRef.source}`}
              className="h-full w-full overflow-hidden bg-black [&_.lk-participant-tile]:h-full [&_.lk-participant-tile]:w-full [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
            >
              <ParticipantTile trackRef={trackRef} />
            </div>
          ))}
        </div>
      ) : (
       <div className="grid h-full w-full place-items-center bg-[#08000f]">
  <div className="text-center">
    <div className="mb-2 text-2xl font-black text-white">
      David
    </div>

    <div className="text-zinc-400">
      Camera Off
    </div>
  </div>
</div>
      )}

      <CustomControls />
    </div>
  );
}

function CustomControls() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();

  const [micOn, setMicOn] = useState(false);
const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
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
  }

  async function toggleScreen() {
    const next = !screenOn;
    await localParticipant.setScreenShareEnabled(next);
    setScreenOn(next);
  }

  function leaveRoom() {
    room.disconnect();
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
      <button onClick={toggleMic} className={controlClass(micOn)}>
        {micOn ? "Mic On" : "Mic Off"}
      </button>

      <button onClick={toggleCam} className={controlClass(camOn)}>
  {camOn ? "End Live" : "Go Live"}
</button>

      <button onClick={useObsVirtualCamera} className={controlClass(obsOn)}>
  {obsOn ? "OBS On" : "OBS Cam"}
</button>

      <button
        onClick={leaveRoom}
        className="rounded-full bg-red-600 px-4 py-2 text-sm font-black text-white hover:bg-red-500"
      >
        Leave
      </button>
    </div>
  );
}

function controlClass(active: boolean) {
  return active
    ? "rounded-full bg-white px-4 py-2 text-sm font-black text-black hover:bg-zinc-200"
    : "rounded-full bg-zinc-800 px-4 py-2 text-sm font-black text-white hover:bg-zinc-700";
}

function StreamMessage({ text }: { text: string }) {
  return (
    <div className="grid h-full w-full place-items-center bg-black text-sm font-bold text-zinc-400">
      {text}
    </div>
  );
}