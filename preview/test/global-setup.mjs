import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
export default function setup() {
  mkdirSync("public",{recursive:true});
  if(!existsSync("public/sample.mp4")) execFileSync("ffmpeg",["-y","-f","lavfi","-i","testsrc2=size=640x360:rate=15","-t","90","-c:v","libx264","-preset","ultrafast","-pix_fmt","yuv420p","-an","public/sample.mp4"],{stdio:"ignore"});
}
