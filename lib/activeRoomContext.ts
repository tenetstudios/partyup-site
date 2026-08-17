export type ActiveRoomContext = {
  roomId: string;
  enteredVia: "qr";
  enteredAt: string;
};

export const activeRoomContextStorageKey = "partyup_active_room_context_v1";
export const activeRoomContextChangeEvent = "partyup-active-room-context-change";

function notifyActiveRoomContextChange() {
  window.dispatchEvent(new Event(activeRoomContextChangeEvent));
}

export function readActiveRoomContext() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(activeRoomContextStorageKey);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<ActiveRoomContext>;

    if (
      typeof parsed.roomId !== "string" ||
      parsed.roomId.trim().length === 0 ||
      parsed.enteredVia !== "qr" ||
      typeof parsed.enteredAt !== "string"
    ) {
      clearActiveRoomContext();
      return null;
    }

    return {
      roomId: parsed.roomId,
      enteredVia: "qr" as const,
      enteredAt: parsed.enteredAt,
    };
  } catch {
    clearActiveRoomContext();
    return null;
  }
}

export function writeActiveRoomContext(roomId: string) {
  if (typeof window === "undefined") {
    return;
  }

  const context: ActiveRoomContext = {
    roomId,
    enteredVia: "qr",
    enteredAt: new Date().toISOString(),
  };

  window.localStorage.setItem(activeRoomContextStorageKey, JSON.stringify(context));
  notifyActiveRoomContextChange();
}

export function clearActiveRoomContext() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(activeRoomContextStorageKey);
  notifyActiveRoomContextChange();
}
