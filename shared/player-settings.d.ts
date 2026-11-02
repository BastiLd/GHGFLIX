export interface SubtitleStyle { sizePercent: number; textColor: string; textOpacity: number; backgroundColor: string; backgroundOpacity: number; fontFamily: "sans" | "serif" | "mono"; bold: boolean; edgeStyle: "none" | "outline" | "shadow"; edgeColor: string; edgeWidth: number; bottomPercent: number; delaySeconds: number }
export interface GestureSettings { doubleTap: boolean; skipSeconds: number; hold: boolean; holdRate: number; swipeBrightness: boolean; swipeVolume: boolean; volumeTarget: "player" | "system" }
export interface PlayerField { key: string; label: string; type: string; min?: number; max?: number; step?: number; choices?: [string, string][]; nativeOnly?: boolean }
export const SUBTITLE_DEFAULTS: SubtitleStyle;
export const GESTURE_DEFAULTS: GestureSettings;
export const SUBTITLE_FIELDS: PlayerField[];
export const GESTURE_FIELDS: PlayerField[];
export function normalizeSubtitle(v: unknown): SubtitleStyle;
export function normalizeGestures(v: unknown): GestureSettings;
export function legacySubtitle(v?: Record<string, unknown>): SubtitleStyle;
export function rgba(hex: string, percent?: number): string;
