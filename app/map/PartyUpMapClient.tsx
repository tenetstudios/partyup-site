"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  getActivity,
  getCategory,
  getRoomCoordinates,
  getRoomLocation,
  getRoomTitle,
  type LiveRoom,
} from "@/lib/homeHelpers";

const filters = ["All", "Party", "Concert", "DJ Set", "Pop-Up", "Sports", "Watch Party"];
const toronto = { latitude: 43.6532, longitude: -79.3832 };

type MapRoom = LiveRoom & {
  coordinates: {
    latitude: number;
    longitude: number;
  };
};

function normalizeFilter(value: string) {
  return value.toLowerCase().replace(/[-_]/g, " ");
}

function getBounds(rooms: MapRoom[]) {
  if (rooms.length === 0) {
    return {
      minLat: toronto.latitude - 0.06,
      maxLat: toronto.latitude + 0.06,
      minLng: toronto.longitude - 0.06,
      maxLng: toronto.longitude + 0.06,
    };
  }

  const latitudes = rooms.map((room) => room.coordinates.latitude);
  const longitudes = rooms.map((room) => room.coordinates.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latPad = Math.max((maxLat - minLat) * 0.18, 0.015);
  const lngPad = Math.max((maxLng - minLng) * 0.18, 0.015);

  return {
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
    minLng: minLng - lngPad,
    maxLng: maxLng + lngPad,
  };
}

function positionRoom(room: MapRoom, bounds: ReturnType<typeof getBounds>) {
  const x = ((room.coordinates.longitude - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * 100;
  const y = (1 - (room.coordinates.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;

  return {
    left: `${Math.min(96, Math.max(4, x))}%`,
    top: `${Math.min(92, Math.max(8, y))}%`,
  };
}

export default function PartyUpMapClient({ rooms }: { rooms: LiveRoom[] }) {
  const mappedRooms = useMemo<MapRoom[]>(
    () =>
      rooms
        .map((room) => {
          const coordinates = getRoomCoordinates(room);
          return coordinates ? ({ ...room, coordinates } as MapRoom) : null;
        })
        .filter((room): room is MapRoom => Boolean(room)),
    [rooms],
  );
  const [activeFilter, setActiveFilter] = useState("All");
  const [selectedId, setSelectedId] = useState<string | null>(mappedRooms[0] ? String(mappedRooms[0].id) : null);

  const filteredRooms = useMemo(() => {
    if (activeFilter === "All") {
      return mappedRooms;
    }

    return mappedRooms.filter((room) => normalizeFilter(getCategory(room)) === normalizeFilter(activeFilter));
  }, [activeFilter, mappedRooms]);

  const selectedRoom =
    filteredRooms.find((room) => String(room.id) === selectedId) ?? filteredRooms[0] ?? null;
  const bounds = getBounds(filteredRooms.length > 0 ? filteredRooms : mappedRooms);

  return (
    <section className="mx-auto grid w-full max-w-[1458px] gap-4 px-5 py-5 xl:px-0">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-[#c35dff]">Explore</p>
          <h1 className="mt-2 text-4xl font-black tracking-normal md:text-5xl">Map</h1>
          <p className="mt-3 text-sm font-bold leading-6 text-[#aaa4b8]">Live rooms around you, powered by real PartyUp room locations.</p>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {filters.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => {
                setActiveFilter(filter);
                setSelectedId(null);
              }}
              className={`h-9 shrink-0 rounded-full border px-4 text-sm font-black ${
                activeFilter === filter
                  ? "border-[#8b3dff] bg-[#8b3dff]/20 text-white"
                  : "border-white/10 bg-white/[0.04] text-[#d6d1df] hover:text-white"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-[calc(100svh-190px)] overflow-hidden rounded-lg border border-white/10 bg-[#070711] shadow-[0_20px_60px_rgba(0,0,0,0.34)]">
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:78px_78px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_22%,rgba(139,61,255,0.26),transparent_28%),radial-gradient(circle_at_76%_64%,rgba(255,45,154,0.18),transparent_30%),linear-gradient(135deg,#09090f,#15102a_48%,#05040b)]" />
        <div className="absolute left-[8%] top-[18%] h-[64%] w-[78%] rotate-[-8deg] rounded-[50%] border border-purple-300/10" />
        <div className="absolute left-[21%] top-[7%] h-[88%] w-[48%] rotate-[18deg] border-l border-purple-300/10" />
        <div className="absolute bottom-4 left-4 rounded-md border border-white/10 bg-black/55 px-3 py-2 text-xs font-bold text-[#aaa4b8] backdrop-blur">
          {filteredRooms.length} mapped {filteredRooms.length === 1 ? "room" : "rooms"}
        </div>

        {mappedRooms.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="max-w-md rounded-lg border border-dashed border-purple-300/20 bg-black/45 p-7 backdrop-blur">
              <h2 className="text-xl font-black">No mapped rooms right now.</h2>
              <p className="mt-3 text-sm font-bold leading-6 text-[#aaa4b8]">Rooms need live status and valid coordinates before they appear on the map.</p>
              <Link href="/live-now" className="mt-6 inline-flex h-10 items-center rounded-md bg-[#8b3dff] px-4 text-sm font-black text-white">
                View Live Now
              </Link>
            </div>
          </div>
        ) : (
          filteredRooms.map((room) => {
            const selected = selectedRoom && String(selectedRoom.id) === String(room.id);
            const activity = getActivity(room);
            const heatSize = Math.min(132, 52 + activity * 10);

            return (
              <button
                key={String(room.id)}
                type="button"
                aria-label={`Preview ${getRoomTitle(room)}`}
                onClick={() => setSelectedId(String(room.id))}
                className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={positionRoom(room, bounds)}
              >
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-1/2 rounded-full bg-[#8b3dff]/20 blur-[1px]"
                  style={{
                    height: `${heatSize}px`,
                    width: `${heatSize}px`,
                    transform: "translate(-50%, -50%)",
                  }}
                />
                <span className={`relative grid h-10 w-10 place-items-center rounded-full border-2 border-white bg-[#8b3dff] shadow-[0_0_22px_rgba(139,61,255,0.75)] ${selected ? "scale-110 bg-[#ff2d9a]" : ""}`}>
                  <span className="h-3.5 w-3.5 rounded-full bg-white" />
                </span>
              </button>
            );
          })
        )}

        {selectedRoom && (
          <div className="absolute bottom-4 left-4 right-4 z-20 rounded-lg border border-white/10 bg-[#10101a]/95 p-4 shadow-2xl shadow-purple-950/40 backdrop-blur md:left-auto md:w-[360px]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#ff4aa2]">Live</p>
                <h2 className="mt-1 truncate text-lg font-black">{getRoomTitle(selectedRoom)}</h2>
                <p className="mt-1 truncate text-sm font-bold text-[#c9c2d7]">{getRoomLocation(selectedRoom) ?? "Online"}</p>
              </div>
              <span className="shrink-0 rounded-full bg-black/60 px-2.5 py-1 text-xs font-black text-white">
                {getActivity(selectedRoom)} people
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-[5px] bg-purple-500/20 px-2 py-1 text-xs font-bold text-[#d6b8ff]">{getCategory(selectedRoom)}</span>
              {typeof selectedRoom.mode === "string" && selectedRoom.mode.trim() && (
                <span className="rounded-[5px] bg-white/10 px-2 py-1 text-xs font-bold capitalize text-[#c9c2d7]">{selectedRoom.mode.replace("_", " ")}</span>
              )}
            </div>
            <Link
              href={`/room/${selectedRoom.id}`}
              className="mt-4 grid h-10 place-items-center rounded-md bg-[#8b3dff] text-sm font-black text-white hover:bg-[#7b31e8]"
            >
              Open Room
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
