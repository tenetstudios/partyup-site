"use client";

import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  VideoConference,
} from "@livekit/components-react";
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

      const displayName =
        profile?.username || `Guest ${user.id.slice(0, 4)}`;

      const { data, error } = await supabase.functions.invoke("livekit-token", {
        body: {
          roomName: roomId,
          participantName: displayName,
          canPublish: true,
        },
      });

      if (error) {
        console.log("LIVEKIT TOKEN ERROR:", error);
        setError(error.message);
        return;
      }

      setToken(data.token);
    }

    getToken();
  }, [roomId]);

  if (!livekitUrl) {
    return (
      <div className="mt-8 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-200">
        Missing NEXT_PUBLIC_LIVEKIT_URL.
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-8 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-200">
        {error}
      </div>
    );
  }

  if (!token) {
    return (
      <div className="mt-8 rounded-lg border border-white/10 bg-black/30 p-6 text-zinc-300">
        Connecting to livestream...
      </div>
    );
  }

  return (
  <LiveKitRoom
    serverUrl={livekitUrl}
    token={token}
    connect={true}
    audio={true}
    video={true}
  >
    <div className="h-full w-full overflow-hidden bg-black [&_.lk-video-conference]:h-full [&_.lk-video-conference]:bg-black">
      <VideoConference />
    </div>
  </LiveKitRoom>
);
}