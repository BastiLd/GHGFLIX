import type { GestureSettings } from "./player-settings.js";
export interface GestureCallbacks { settings(): GestureSettings; canHold(): boolean; onTap(): void; onSeek(seconds: number): void; onHold(active: boolean): void; onSwipe(kind: "volume" | "brightness", delta: number): void }
export function createPlayerGestures(callbacks: GestureCallbacks, clock?: unknown): { start(x: number, y: number, width: number, height: number): void; move(x: number, y: number): void; end(): void; cancel(): void };
