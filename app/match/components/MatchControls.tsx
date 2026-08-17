"use client";
import React from "react";

type MatchControlsProps = {
  cameraEnabled?: boolean;
  keepInTouchStatus?: "idle" | "saving" | "saved" | "connected";
  microphoneEnabled?: boolean;
  nextBusy?: boolean;
  onCameraToggle?: () => void;
  onKeepInTouch?: () => void;
  onLeave?: () => void;
  onMicrophoneToggle?: () => void;
  onNext?: () => void;
};

export default function MatchControls({
  cameraEnabled = false,
  keepInTouchStatus = "idle",
  microphoneEnabled = false,
  nextBusy = false,
  onCameraToggle,
  onKeepInTouch,
  onLeave,
  onMicrophoneToggle,
  onNext,
}: MatchControlsProps) {
  const keepInTouchLabel =
    keepInTouchStatus === "connected"
      ? "Connected"
      : keepInTouchStatus === "saved"
        ? "Saved"
        : keepInTouchStatus === "saving"
          ? "Saving..."
          : "Keep in Touch";
  const keepInTouchDisabled =
    !onKeepInTouch || keepInTouchStatus === "saving" || keepInTouchStatus === "connected";

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
        disabled={keepInTouchDisabled}
        onClick={onKeepInTouch}
        className={
          keepInTouchStatus === "connected"
            ? "rounded-md bg-emerald-500 px-3 py-2 text-sm font-black text-black disabled:cursor-default"
            : keepInTouchStatus === "saved"
              ? "rounded-md bg-white px-3 py-2 text-sm font-black text-black hover:bg-zinc-200"
              : "rounded-md bg-[#1f1a2b] px-3 py-2 text-sm font-bold text-white hover:bg-[#2b243b] disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        {keepInTouchLabel}
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
