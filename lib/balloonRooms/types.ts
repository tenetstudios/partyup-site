export type BalloonStatus = "active" | "popped" | "escaped";

export type Balloon = {
  id: string;
  roomId: string;
  x: number;
  y: number;
  health: number;
  maxHealth: number;
  speed: number;
  radius: number;
  roomDamage: number;
  status: BalloonStatus;
};

export type BalloonRoom = {
  id: string;
  health: number;
  maxHealth: number;
  balloons: Balloon[];
  width: number;
  height: number;
};

export type BalloonSimulationEvent =
  | { type: "balloon_popped"; balloon: Balloon }
  | { type: "balloon_escaped"; balloon: Balloon; damage: number };

export type BalloonDamageResult = {
  balloonId: string;
  remainingHealth: number;
  popped: boolean;
};
