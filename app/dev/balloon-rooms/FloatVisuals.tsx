import { useId, type ReactNode } from "react";
import { INCOME_TICK_INTERVAL_MS, ROOM_MAX_HEALTH, type SpawnLane } from "@partyup/balloon-core";
import styles from "./BalloonRooms.module.css";

export function Coin() {
  return <span className={styles.coin} aria-hidden="true" />;
}

export function FloatIcon({ kind }: { kind: string }) {
  const id = useId().replaceAll(":", "");
  const balloon = ["basic", "speed", "heavy"].includes(kind);
  const colors = kind === "speed" ? ["#b3efff", "#1680ff", "#153bd4"] : kind === "heavy" ? ["#b7a4c7", "#493b60", "#211b35"] : ["#ffbbc5", "#ff294e", "#c50038"];
  return <svg viewBox="0 0 80 76" className={styles.itemIcon} aria-hidden="true">
    <defs>
      <radialGradient id={`${id}b`} cx="70%" cy="24%" r="78%"><stop stopColor={colors[0]} /><stop offset=".3" stopColor={colors[1]} /><stop offset="1" stopColor={colors[2]} /></radialGradient>
      <linearGradient id={`${id}m`}><stop stopColor="#33455e" /><stop offset=".42" stopColor="#e4edf6" /><stop offset=".65" stopColor="#7c8b9e" /><stop offset="1" stopColor="#344459" /></linearGradient>
      <linearGradient id={`${id}w`} x2=".2" y2="1"><stop stopColor="#fffef8" /><stop offset="1" stopColor="#c9c5c0" /></linearGradient>
    </defs>
    {balloon ? <>
      <path d="M40 61 C4 40 14 6 40 5 C68 4 77 40 40 61Z" fill={`url(#${id}b)`} stroke={colors[0]} strokeOpacity=".4" />
      <ellipse cx="52" cy="17" rx="4" ry="8" transform="rotate(-28 52 17)" fill="white" opacity=".8" />
      <path d="M40 59 L36 66 L44 66Z" fill={colors[1]} /><path d="M40 66 Q37 71 41 75" fill="none" stroke="#fff" strokeOpacity=".65" />
    </> : kind === "wall" ? <g stroke="#b6b7b8" strokeWidth=".7">
      <path d="M8 30 L61 14 L72 20 L19 38Z" fill="#fffef7" /><path d="M61 14 L72 20 L72 54 L61 49Z" fill="#bbb9b8" />
      {[0, 1].map(row => [0, 1, 2].map(col => <path key={`${row}${col}`} d={`M${8+col*18} ${30+row*18-col*5.4} l18 -5.4 v18 l-18 5.4Z`} fill={`url(#${id}w)`} />))}
    </g> : kind === "nails" ? <g fill={`url(#${id}m)`} stroke="#b3c2d4" strokeWidth=".7">{[20, 40, 60].map((x, i) => <path key={x} d={`M${x} ${14+i%2*6} l-6 43 q6 6 12 0Z M${x-9} 57 q9 7 18 0 l-1 5 q-8 5 -16 0Z`} />)}</g> : kind === "glue" ? <>
      <path d="M23 26 Q40 21 57 26 L60 59 Q40 70 20 59Z" fill="#c4edff" fillOpacity=".7" stroke="#effaff" /><path d="M22 40 Q40 45 58 39 L59 58 Q40 66 21 58Z" fill="#f8e2a6" fillOpacity=".9" /><ellipse cx="40" cy="24" rx="18" ry="5" fill="#fafcff" /><path d="M22 17 Q40 10 58 16 L58 23 Q40 30 22 24Z" fill={`url(#${id}w)`} /><path d="M30 35 L29 53" stroke="white" strokeWidth="4" opacity=".7" />
    </> : <path d="M24 23 L56 55 M56 23 L24 55" stroke="white" strokeWidth="5" strokeLinecap="round" />}
  </svg>;
}

export function FloatHeader({ round, subtitle, connection, children }: { round: ReactNode; subtitle: ReactNode; connection: string; children: ReactNode }) {
  return <header className={styles.header}>
    <div className={styles.brand}><h1>FLOAT</h1><p>BUILD · DEFEND · OUTLAST</p></div>
    <div className={styles.roundBar}><h2>{round}</h2><p>{subtitle}</p></div>
    <div className={styles.headerActions}><span className={styles.connection}><i />{connection}</span><details className={styles.settings}><summary aria-label="Float settings">⚙</summary><div className={styles.settingsPanel}>{children}</div></details></div>
  </header>;
}

export function RoomHeader({ label, coins, income, health }: { label: string; coins: number; income: number; health: number }) {
  return <div className={styles.roomHeader}><h2>{label}</h2><div className={styles.economyPanel}><span><Coin />{coins}</span><small>+{income}/{INCOME_TICK_INTERVAL_MS / 1000}s</small></div><p className={styles.health} aria-label={`Health ${health} of ${ROOM_MAX_HEALTH}`}><span aria-hidden="true">♥</span>{health} / {ROOM_MAX_HEALTH}</p></div>;
}

export function LanePicker({ lane, onSelect }: { lane: SpawnLane; onSelect: (lane: SpawnLane) => void }) {
  return <div className={styles.lanePicker} aria-label="Choose attack lane">{([1, 2, 3, 4] as SpawnLane[]).map(item => <button key={item} type="button" aria-label={`Target Lane ${item}`} aria-pressed={lane === item} onClick={() => onSelect(item)} className={lane === item ? styles.laneSelected : undefined}><span className={styles.laneLabel}>LANE {item}</span><span className={styles.chevrons} aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</span></button>)}</div>;
}
