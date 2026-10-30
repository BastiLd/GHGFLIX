import React from "react";
import { Image } from "react-native";
import daten from "./icon-daten.js";

const alias = { "▶": "play", "⏸": "pause", "⏪": "rewind", "⏩": "forward", "⏭": "next", "🔊": "audio", "💬": "subtitles", "←": "back", "✓": "check", "♡": "heart", "♥": "heart", "▾": "down", "★": "star", "▣": "library", "↺": "rewind", "⬇": "download", "⟳": "refresh", "👤": "user" };

/** PNG-Maske mit einheitlicher Strichstärke, unabhängig von Androids Emoji-Schrift. */
export function Icon({ name, size = 24, color = "#fff", style }) {
  const uri = daten[alias[name] || name];
  if (!uri) return null;
  return <Image accessible={false} importantForAccessibility="no" source={{ uri }} resizeMode="contain" style={[{ width: size, height: size, tintColor: color }, style]} />;
}
