import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
export default function setup() {
  mkdirSync("tests/.generated", {recursive:true});
  execFileSync("ffmpeg", ["-y","-f","lavfi","-i","color=c=blue:s=320x180:r=10","-t","90","-c:v","libvpx","-b:v","40k","tests/.generated/video.webm"], {stdio:"ignore"});
}
