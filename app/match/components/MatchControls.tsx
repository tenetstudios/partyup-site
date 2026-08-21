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
        ? "Request saved"
        : keepInTouchStatus === "saving"
          ? "Saving..."
          : "Stay connected";
  const keepInTouchDisabled =
    !onKeepInTouch || keepInTouchStatus === "saving" || keepInTouchStatus === "connected";

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/70 p-2.5 shadow-2xl backdrop-blur-xl sm:gap-3 sm:p-3">
      <button
        disabled={!onNext || nextBusy}
        onClick={onNext}
        className="min-h-11 rounded-full bg-[#9146ff] px-4 py-2 text-sm font-black text-white transition hover:bg-[#a05cff] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {nextBusy ? "Tuning..." : "Next match"}
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
            ? "min-h-11 rounded-full bg-emerald-500 px-4 py-2 text-sm font-black text-black disabled:cursor-default"
            : keepInTouchStatus === "saved"
              ? "min-h-11 rounded-full bg-white px-4 py-2 text-sm font-black text-black hover:bg-zinc-200"
              : "min-h-11 rounded-full bg-[#1f1a2b] px-4 py-2 text-sm font-bold text-white hover:bg-[#2b243b] disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        {keepInTouchLabel}
      </button>
      <button
        disabled
        className="min-h-11 rounded-full bg-red-600 px-4 py-2 text-sm font-bold opacity-50"
      >
        Report
      </button>
      {onLeave && (
        <button
          onClick={onLeave}
          className="min-h-11 rounded-full border border-white/15 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
        >
          Leave
        </button>
      )}
    </div>
  );
}

function controlClass(active: boolean) {
  return active
    ? "min-h-11 rounded-full bg-white px-4 py-2 text-sm font-black text-black hover:bg-zinc-200"
    : "min-h-11 rounded-full bg-[#1f1a2b] px-4 py-2 text-sm font-bold text-white hover:bg-[#2b243b]";
}
