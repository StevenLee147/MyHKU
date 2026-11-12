import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const file = join(root, "out", "myhku-launch-1080p.mp4");
const require = createRequire(import.meta.url);
const bundled =
  process.platform === "win32"
    ? dirname(
        require.resolve("@remotion/compositor-win32-x64-msvc/package.json"),
      )
    : null;
const run = (tool, args, encoding = "utf8") => {
  const executable =
    process.env[tool.toUpperCase()] ||
    (bundled ? join(bundled, `${tool}.exe`) : tool);
  const result = spawnSync(executable, args, {
    encoding,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result;
};
const probe = JSON.parse(
  run("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    file,
  ]).stdout,
);
const video = probe.streams.find((stream) => stream.codec_type === "video");
const audio = probe.streams.find((stream) => stream.codec_type === "audio");
assert.ok(video && audio, "Video and audio streams must both exist");
assert.equal(video.codec_name, "h264");
assert.equal(video.width, 1920);
assert.equal(video.height, 1080);
assert.equal(video.pix_fmt, "yuv420p");
assert.equal(video.color_range, "tv");
assert.equal(video.color_space, "bt709");
assert.equal(video.avg_frame_rate, "30/1");
assert.equal(Number(video.nb_frames), 1440);
assert.ok(
  Math.abs(Number(probe.format.duration) - 48) <= 0.1,
  "Film must be exactly 48 seconds within codec padding",
);
assert.equal(audio.codec_name, "aac");
assert.equal(audio.sample_rate, "48000");
assert.equal(audio.channels, 2);
const decode = run("ffmpeg", [
  "-v", "error", "-xerror", "-err_detect", "explode",
  "-i", file, "-map", "0:v:0", "-an",
  "-c:v", "rawvideo", "-f", "null", "-",
]);
assert.equal(
  decode.stderr.trim(),
  "",
  "Full video/audio decode should be clean",
);
const decodedAudio = run("ffmpeg", [
  "-v", "error", "-xerror", "-err_detect", "explode",
  "-i", file, "-vn", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1",
], null);
assert.equal(decodedAudio.stderr.length, 0, "Full audio decode should be clean");
const wav = decodedAudio.stdout;
assert.equal(wav.toString("ascii", 0, 4), "RIFF");
assert.equal(wav.toString("ascii", 8, 12), "WAVE");
let pcm;
for (let offset = 12; offset + 8 <= wav.length;) {
  const size = wav.readUInt32LE(offset + 4);
  if (wav.toString("ascii", offset, offset + 4) === "data") {
    pcm = wav.subarray(offset + 8, Math.min(offset + 8 + size, wav.length));
    break;
  }
  offset += 8 + size + (size % 2);
}
assert.ok(pcm && pcm.length > 0 && pcm.length % 4 === 0, "Decoded stereo PCM must exist");
let peak = 0;
for (let offset = 0; offset < pcm.length; offset += 2) {
  peak = Math.max(peak, Math.abs(pcm.readInt16LE(offset)) / 32768);
}
const peakDbfs = 20 * Math.log10(peak);
assert.ok(
  Number.isFinite(peakDbfs) && peakDbfs < 0,
  "Audio must have headroom after AAC encoding",
);
const bytes = await readFile(file);
const report = {
  file: "myhku-launch-1080p.mp4",
  durationSeconds: Number(probe.format.duration),
  width: video.width,
  height: video.height,
  fps: 30,
  frames: Number(video.nb_frames),
  codec: video.codec_name,
  pixelFormat: video.pix_fmt,
  colorSpace: video.color_space,
  colorRange: video.color_range,
  audio: {
    codec: audio.codec_name,
    sampleRate: Number(audio.sample_rate),
    channels: audio.channels,
    peakDbfs,
  },
  sizeBytes: (await stat(file)).size,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  fullDecode: "PASS",
};
await writeFile(
  join(root, "out", "verification.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
