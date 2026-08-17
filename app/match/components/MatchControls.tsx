"use client";
import React from "react";

type MatchControlsProps = {
  cameraEnabled?: boolean;
  microphoneEnabled?: boolean;
  nextBusy?: boolean;
  onCameraToggle?: () => void;
  onLeave?: () => void;
  onMicrophoneToggle?: () => void;
  onNext?: () => void;
};

export default function MatchControls({
  cameraEnabled = false,
  microphoneEnabled = false,
  nextBusy = false,
  onCameraToggle,
  onLeave,
  onMicrophoneToggle,
  onNext,
}: MatchControlsProps) {
  return (
    <div className="flex items-center justify-center gap-4 rounded-md bg-black/30 p-3">
      <button
        disabled={!onNext || nextBusy}
        onClick={onNext}
        className="rounded-md bg-[#9146ff] px-3 py-2 text-sm font-black text-white hover:bg-[#7b31e8] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {nextBusy ? "Finding..." : "Next"}
      </button>
      <button
        onClick={onMicrophoneToggle}
        className={controlClass(microphoneEnabled)}
      >
        {microphoneEnabled ? "Mute" : "Unmute"}
      </button>
      <button
        onClick={onCameraToggle}
        className={controlClass(cameraEnabled)}
      >
        {cameraEnabled ? "Camera Off" : "Camera On"}
      </button>
      <button
        disabled
        className="rounded-md bg-[#1f1a2b] px-3 py-2 text-sm font-bold opacity-50"
      >
        Follow
      </button>
      <button
        disabled
        className="rounded-md bg-red-600 px-3 py-2 text-sm font-bold opacity-50"
      >
        Report
      </button>
      {onLeave && (
        <button
          onClick={onLeave}
          className="rounded-md border border-white/15 px-3 py-2 text-sm font-bold text-white hover:bg-white/10"
        >
          Leave
        </button>
      )}
    </div>
  );
}

function controlClass(active: boolean) {
  return active
    ? "rounded-md bg-white px-3 py-2 text-sm font-black text-black hover:bg-zinc-200"
    : "rounded-md bg-[#1f1a2b] px-3 py-2 text-sm font-bold text-white hover:bg-[#2b243b]";
}
