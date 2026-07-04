// Generates src-tauri/icons/source.png (1024x1024) for the GHGFlix app icon.
// Run: node scripts/make-icon.mjs   then:  npx tauri icon src-tauri/icons/source.png
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const svg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#141417"/>
      <stop offset="1" stop-color="#050506"/>
    </linearGradient>
    <linearGradient id="red" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff2a39"/>
      <stop offset="1" stop-color="#b00610"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <rect x="20" y="20" width="984" height="984" rx="206" fill="none" stroke="#e50914" stroke-opacity="0.25" stroke-width="8"/>
  <!-- play triangle -->
  <path d="M408 300 L744 512 L408 724 Z" fill="url(#red)"/>
  <!-- ZickZack signature -->
  <polyline points="250,792 360,732 470,792 580,732 690,792 800,732"
    fill="none" stroke="#e50914" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

mkdirSync("src-tauri/icons", { recursive: true });
await sharp(Buffer.from(svg)).resize(1024, 1024).png().toFile("src-tauri/icons/source.png");
console.log("Wrote src-tauri/icons/source.png");
