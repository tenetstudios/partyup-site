"use client";
import React, { useState } from "react";
import MatchIdle from "./components/MatchIdle";
import MatchSearching from "./components/MatchSearching";
import MatchConnected from "./components/MatchConnected";
import MatchDisconnected from "./components/MatchDisconnected";

export type MatchState = "idle" | "searching" | "connected" | "disconnected";

export default function MatchScreen() {
  const [state, setState] = useState<MatchState>("idle");

  return (
    <div className="min-h-[70vh]">
      {state === "idle" && <MatchIdle onStart={() => setState("searching")} />}
      {state === "searching" && <MatchSearching onCancel={() => setState("idle")} />}
      {state === "connected" && <MatchConnected />}
      {state === "disconnected" && <MatchDisconnected onRematch={() => setState("searching")} />}
    </div>
  );
}
