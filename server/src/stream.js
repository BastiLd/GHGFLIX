// Video delivery: ffprobe (codec info), direct play with HTTP Range support,
// and on-the-fly ffmpeg transcoding to fragmented MP4 (h264/aac) that every
// browser and phone can play — with instant seeking via ?t=<seconds>.
import { spawn } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { extname } from "node:path";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

const MIME = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".ts": "video/mp2t",
  ".m2ts": "video/mp2t",
};

export function ffprobe(path) {
  return new Promise((resolve) => {
    const p = spawn(FFPROBE, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve(null));
    p.on("close", () => {
      try {
        const j = JSON.parse(out);
        const v = (j.streams || []).find((s) => s.codec_type === "video");
        const a = (j.streams || []).find((s) => s.codec_type === "audio");
        resolve({
          duration: parseFloat(j.format?.duration) || null,
          container: (j.format?.format_name || "").split(",")[0],
          vcodec: v?.codec_name ?? null,
          acodec: a?.codec_name ?? null,
          width: v?.width ?? null,
          height: v?.height ?? null,
          audioStreams: (j.streams || [])
            .filter((s) => s.codec_type === "audio")
            .map((s, i) => ({ index: i, lang: s.tags?.language ?? null, title: s.tags?.title ?? null, codec: s.codec_name })),
          subtitleStreams: (j.streams || [])
            .filter((s) => s.codec_type === "subtitle")
            .map((s, i) => ({ index: i, lang: s.tags?.language ?? null, title: s.tags?.title ?? null, codec: s.codec_name })),
        });
      } catch {
        resolve(null);
      }
    });
  });
}

/** Can the browser play this file as-is (no transcode)? */
export function canDirectPlay(row) {
  const ext = extname(row.path).toLowerCase();
  const containerOk = ext === ".mp4" || ext === ".m4v" || ext === ".webm";
  const vOk = ["h264", "vp9", "av1", "vp8"].includes(row.vcodec ?? "");
  const aOk = ["aac", "mp3", "opus", "vorbis", "flac"].includes(row.acodec ?? "");
  return containerOk && vOk && aOk;
}

/** Direct file streaming with Range support (the <video> element needs it). */
export function serveFile(req, res, path) {
  let st;
  try {
    st = statSync(path);
  } catch {
    res.writeHead(404).end("file not found");
    return;
  }
  const mime = MIME[extname(path).toLowerCase()] || "application/octet-stream";
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m?.[1] ? parseInt(m[1], 10) : 0;
    let end = m?.[2] ? parseInt(m[2], 10) : st.size - 1;
    if (start >= st.size) {
      res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end();
      return;
    }
    end = Math.min(end, st.size - 1);
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${st.size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": mime,
    });
    createReadStream(path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { "Content-Length": st.size, "Content-Type": mime, "Accept-Ranges": "bytes" });
    createReadStream(path).pipe(res);
  }
}

const QUALITY = {
  low: { height: 480, vbr: "1500k", maxrate: "2000k" },
  medium: { height: 720, vbr: "3000k", maxrate: "4000k" },
  high: { height: 1080, vbr: "6000k", maxrate: "8000k" },
  original: null, // keep resolution, just convert the codec
};

/** Live transcode from `start` seconds → fragmented MP4 piped to the client.
 *  h264 video is stream-copied when only the audio/container is the problem. */
export function serveTranscode(req, res, row, { start = 0, quality = "original", audioIndex = 0 } = {}) {
  const q = QUALITY[quality] ?? QUALITY.original;
  const copyVideo = row.vcodec === "h264" && !q;

  // -fflags +genpts: rebuild missing/broken timestamps (MKV/TS sources) so
  // audio and video share one clean clock instead of drifting apart.
  const args = ["-hide_banner", "-loglevel", "error", "-fflags", "+genpts"];
  if (start > 0) args.push("-ss", String(start));
  args.push("-i", row.path, "-map", "0:v:0", "-map", `0:a:${audioIndex}?`);

  if (copyVideo) {
    args.push("-c:v", "copy");
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p");
    if (q) args.push("-vf", `scale=-2:min(${q.height}\\,ih)`, "-maxrate", q.maxrate, "-bufsize", q.maxrate);
  }
  args.push("-c:a", "aac", "-ac", "2", "-b:a", "160k");
  // A/V-Sync: lock the audio to the video clock. aresample=async stretches or
  // pads tiny gaps sample-accurately instead of letting the offset accumulate
  // (the "audio runs ahead / lags behind after a few minutes" bug).
  args.push("-af", "aresample=async=1:min_hard_comp=0.100:first_pts=0");
  args.push("-avoid_negative_ts", "make_zero", "-max_muxing_queue_size", "2048");
  args.push("-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1");

  const ff = spawn(FFMPEG, args);
  res.writeHead(200, { "Content-Type": "video/mp4", "Cache-Control": "no-store" });
  ff.stdout.pipe(res);
  ff.stderr.on("data", () => {});
  const kill = () => {
    try {
      ff.kill("SIGKILL");
    } catch {}
  };
  req.on("close", kill);
  ff.on("close", () => res.end());
  ff.on("error", () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
}

/** One JPEG frame (for episode thumbnails without TMDb art). */
export function serveThumb(res, path, at = 300) {
  const ff = spawn(FFMPEG, [
    "-hide_banner", "-loglevel", "error",
    "-ss", String(at), "-i", path,
    "-frames:v", "1", "-vf", "scale=480:-2", "-f", "image2", "-c:v", "mjpeg", "pipe:1",
  ]);
  res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=604800" });
  ff.stdout.pipe(res);
  ff.on("error", () => res.end());
}
