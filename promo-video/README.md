# MyHKU — Less searching. More learning.

A 48-second launch film, created specifically for MyHKU. 1920 × 1080, 30 fps, BT.709 H.264 video and stereo AAC audio. English headlines, Chinese supporting copy, authentic app screens, and an original procedural soundtrack.

## Watch and export

Run these commands from `promo-video`:

```powershell
npm install
npm run dev
npm run lint
npm run render
npm run poster
npm run verify
npm run preview
```

- `out\myhku-launch-1080p.mp4` — final film, suitable for web and social uploads.
- `out\myhku-poster.png` — matching 1080p cover image.
- `out\myhku-storyboard.jpg` — nine representative frames from the completed export.
- `out\verification.json` — media dimensions, duration, audio peak, SHA-256, and full decode result.
- `npm run dev` — editable Remotion Studio. Select **MyHKU-Launch**.
- `npm run preview` — local viewing page at `http://127.0.0.1:8188` (Ctrl+C to stop).

The `out` directory and `node_modules` are ignored by Git. Source, captured images, provenance, and original audio are retained in this project. Render output can be recreated with the commands above.

## Film structure

| Time | Story |
| --- | --- |
| 0:00–0:04.8 | Your day. Too many tabs. |
| 0:04.8–0:09.6 | Meet MyHKU. |
| 0:09.6–0:19.2 | Start with a clear day. |
| 0:19.2–0:28.8 | Timetable, materials, coursework. |
| 0:28.8–0:33.6 | Official authentication. Local data. |
| 0:33.6–0:38.4 | Windows, Apple Silicon Macs, Android. |
| 0:38.4–0:48 | Less searching. More learning. |

Scene boundaries crossfade for 18 frames. Scene files are in `src\scenes`; typography, device frames, colors, and motion primitives are in `src\design.tsx`. The final call to action stays visible for over six seconds. The film is intentionally understandable without audio.

## Authentic demo screens

The screenshots show the real React application, using its built-in overview demo and a synthetic cached course snapshot. No HKU account, credentials, real student records, or external university data were used. The capture browser blocks university domains and the local account bridge. The date is frozen for reproducibility. Source fixtures and capture details are preserved in `public\captures\provenance.json`.

To recapture after UI changes, start the root Vite app in a separate terminal:

```powershell
npm run dev -- --host 127.0.0.1 --port 5178 --strictPort
```

Then, from `promo-video`, run `npm run capture`. The script uses Remotion's Chromium in an isolated browser profile, closes it when finished, and writes five PNG files. Override the URL with `MYHKU_CAPTURE_URL` if needed. Existing checked-in images are sufficient for normal video rendering.

## Original score

`npm run score` regenerates `public\audio\myhku-original.wav` and its analysis JSON deterministically. The score is 100 BPM, 48 kHz stereo PCM, composed from synthesized pads, plucks, bass, percussion, and a final logo motif. It contains no external samples, music, or services. The film uses a slightly reduced master volume to retain AAC headroom.

## Accuracy and portability

The film identifies MyHKU as **v0.2.1-alpha**, independently developed and not an official HKU application. It preserves official MFA requirements. Supported platforms are Windows x64, macOS Apple Silicon, and Android 8+. It makes no promise of iOS support, cloud synchronization, permanent sign-in, or background updates while closed.

Typography uses system Bahnschrift / Segoe UI and Microsoft YaHei, with platform fallbacks. For matching line breaks and the original visual appearance, render on Windows. All video animation is deterministic and driven by Remotion frames; there are no web fonts, CSS animation timers, or remote runtime assets. First-time Chromium download may require network access.

The verification script uses Remotion's bundled FFmpeg tools on Windows, or `ffmpeg` / `ffprobe` from PATH elsewhere. `FFMPEG` and `FFPROBE` can override their paths.

Remotion's licensing terms apply to its tools: https://www.remotion.dev/license
