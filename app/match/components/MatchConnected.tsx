"use client";
import React from "react";
import VideoPanel from "./VideoPanel";
import MatchControls from "./MatchControls";

export default function MatchConnected() {
  return (
    <div className="h-[80vh] w-full">
      <div className="relative h-full w-full">
        <div className="h-full w-full">
          <VideoPanel label="Remote Participant" />
        </div>

        <div className="absolute right-4 top-4">
          <VideoPanel label="You" small />
        </div>

        <div className="absolute left-0 bottom-6 right-0 flex justify-center px-4">
          <div className="max-w-3xl w-full">
            <MatchControls />
          </div>
        </div>
      </div>
    </div>
  );
}
