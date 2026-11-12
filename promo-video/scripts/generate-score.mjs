import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const SAMPLE_RATE = 48_000;
const DURATION = 48;
const FRAMES = SAMPLE_RATE * DURATION;
const BPM = 100;
const BEAT = 60 / BPM;
const PHRASE = BEAT * 8;
const TAU = Math.PI * 2;
const SEED = 0x4d79484b;
const outputDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio');

let randomState = SEED;
const random = () => {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 4_294_967_296;
};
const noise = () => random() * 2 - 1;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const smooth = (value) => {
  const x = clamp(value);
  return x * x * (3 - 2 * x);
};
const edge = (time, duration, attack, release) =>
  smooth(time / attack) * smooth((duration - time) / release);

const left = new Float32Array(FRAMES);
const right = new Float32Array(FRAMES);
const delayLeft = new Float32Array(FRAMES);
const delayRight = new Float32Array(FRAMES);
const reverbLeft = new Float32Array(FRAMES);
const reverbRight = new Float32Array(FRAMES);
const eventCounts = {};

function voice(type, start, duration, amplitude, pan, delay, reverb, synthesize) {
  eventCounts[type] = (eventCounts[type] ?? 0) + 1;
  const first = Math.round(start * SAMPLE_RATE);
  const samples = Math.round(duration * SAMPLE_RATE);
  const angle = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  const gainLeft = Math.cos(angle) * amplitude;
  const gainRight = Math.sin(angle) * amplitude;
  for (let index = Math.max(0, -first); index < samples && first + index < FRAMES; index++) {
    const frame = first + index;
    const sample = synthesize(index / SAMPLE_RATE);
    const l = sample * gainLeft;
    const r = sample * gainRight;
    left[frame] += l;
    right[frame] += r;
    delayLeft[frame] += l * delay;
    delayRight[frame] += r * delay;
    reverbLeft[frame] += l * reverb;
    reverbRight[frame] += r * reverb;
  }
}

function pluck(start, note, amplitude = 0.09, pan = 0, duration = 1.8) {
  const frequency = hz(note);
  const phase = random() * TAU;
  voice('warmPluck', start, duration, amplitude, pan, 0.44, 0.30, (time) => {
    const p = TAU * frequency * time;
    const body =
      0.76 * Math.sin(p + 0.22 * Math.exp(-time / 0.11) * Math.sin(2 * p)) +
      0.17 * Math.sin(p * 1.0014 + phase) +
      0.19 * Math.sin(2 * p) * Math.exp(-time / 0.27) +
      0.055 * Math.sin(3 * p) * Math.exp(-time / 0.13);
    return body * Math.exp(-time / 0.62) * edge(time, duration, 0.009, 0.18);
  });
}

function chime(start, note, amplitude = 0.105, pan = 0, duration = 2.5) {
  const frequency = hz(note);
  voice('signatureChime', start, duration, amplitude, pan, 0.50, 0.46, (time) => {
    const p = TAU * frequency * time;
    const body =
      0.78 * Math.sin(p + 0.32 * Math.exp(-time / 0.10) * Math.sin(2 * p)) +
      0.16 * Math.sin(p * 0.9991) +
      0.085 * Math.sin(2 * p) * Math.exp(-time / 0.38) +
      0.025 * Math.sin(3 * p) * Math.exp(-time / 0.15);
    return body * Math.exp(-time / 0.94) * edge(time, duration, 0.012, 0.35);
  });
}

function melody(start, note, amplitude = 0.065, pan = 0, duration = 1.7) {
  const frequency = hz(note);
  voice('velvetKeys', start, duration, amplitude, pan, 0.36, 0.40, (time) => {
    const p = TAU * frequency * time;
    const body =
      0.82 * Math.sin(p + 0.45 * Math.exp(-time / 0.19) * Math.sin(2 * p)) +
      0.15 * Math.sin(p * 1.0007) +
      0.08 * Math.sin(2 * p) * Math.exp(-time / 0.28);
    return body * Math.exp(-time / 1.05) * edge(time, duration, 0.018, 0.28);
  });
}

function pad(start, notes, amplitude, duration = 5.7) {
  const pans = [-0.62, 0.46, -0.22, 0.68, 0.12];
  notes.forEach((note, index) => {
    const frequency = hz(note);
    const phase = random() * TAU;
    voice('atmosphericPad', start, duration, amplitude, pans[index], 0.06, 0.62, (time) => {
      const p = TAU * frequency * time;
      const body =
        0.46 * Math.sin(p * 0.9984 + phase) +
        0.40 * Math.sin(p * 1.0016 + phase + 0.18) +
        0.13 * Math.sin(2 * p + phase) +
        0.035 * Math.sin(3 * p + phase);
      const breath = 0.94 + 0.06 * Math.sin(TAU * 0.19 * time + phase);
      const absoluteTime = start + time;
      const pulsing = absoluteTime >= 9.6 && absoluteTime < 44.4;
      const pulse = ((absoluteTime - 9.6) % (BEAT * 2)) / BEAT;
      const duck = pulsing ? 1 - 0.13 * Math.exp(-pulse / 0.23) : 1;
      return body * breath * duck * edge(time, duration, 1.05, 1.45);
    });
  });
}

function bass(start, note, duration = 0.68, amplitude = 0.16) {
  const frequency = hz(note);
  voice('softBass', start, duration, amplitude, 0, 0, 0.035, (time) => {
    const p = TAU * frequency * time;
    const body = Math.sin(p) + 0.15 * Math.sin(2 * p) + 0.035 * Math.sin(3 * p);
    return body * (0.74 + 0.26 * Math.exp(-time / 0.25)) * edge(time, duration, 0.022, 0.15);
  });
}

function kick(start, amplitude = 0.30) {
  const duration = 0.44;
  voice('gentleKick', start, duration, amplitude, 0, 0, 0.025, (time) => {
    // Integrating the falling frequency keeps the pitch sweep continuous.
    const phase = TAU * (46 * time + 79 * 0.024 * (1 - Math.exp(-time / 0.024)));
    const body = Math.sin(phase) + 0.075 * Math.sin(2 * phase) * Math.exp(-time / 0.04);
    return body * Math.exp(-time / 0.13) * edge(time, duration, 0.005, 0.06);
  });
}

function clap(start, amplitude = 0.11, pan = 0.08) {
  const duration = 0.23;
  let low = 0;
  let high = 0;
  voice('softClap', start, duration, amplitude, pan, 0.10, 0.32, (time) => {
    const n = noise();
    low += 0.32 * (n - low);
    high += 0.055 * (low - high);
    const burst = [0, 0.012, 0.026].reduce(
      (sum, offset) => sum + (time >= offset ? Math.exp(-(time - offset) / 0.024) * smooth((time - offset) / 0.002) : 0),
      0,
    );
    return (low - high) * burst * edge(time, duration, 0.003, 0.045);
  });
}

function hat(start, amplitude = 0.037, pan = -0.22, open = false) {
  const duration = open ? 0.25 : 0.11;
  let low = 0;
  let bright = 0;
  voice('brushedHat', start, duration, amplitude, pan, 0.03, 0.14, (time) => {
    const n = noise();
    low += 0.43 * (n - low);
    bright += 0.82 * (n - bright);
    const body = (bright - low) * 0.78;
    return body * Math.exp(-time / (open ? 0.085 : 0.027)) * edge(time, duration, 0.003, 0.035);
  });
}

function airSwell(end, duration = 1.25, amplitude = 0.075) {
  let low = 0;
  let floor = 0;
  voice('airTransition', end - duration, duration + 0.35, amplitude, -0.18, 0.22, 0.70, (time) => {
    low += 0.09 * (noise() - low);
    floor += 0.014 * (low - floor);
    const envelope = time <= duration
      ? smooth(time / duration) ** 1.8
      : Math.exp(-(time - duration) / 0.08);
    return (low - floor) * envelope * edge(time, duration + 0.35, 0.22, 0.16);
  });
}

const harmony = {
  Dmaj9: {root: 38, pad: [50, 57, 61, 64, 66], plucks: [62, 66, 69, 73, 76]},
  Aadd9: {root: 33, pad: [52, 57, 59, 61, 64], plucks: [61, 64, 69, 71, 76]},
  Bm7: {root: 35, pad: [50, 57, 59, 62, 66], plucks: [62, 66, 69, 71, 74]},
  Gmaj7: {root: 31, pad: [50, 55, 59, 62, 66], plucks: [62, 66, 67, 71, 74]},
};
const progression = ['Dmaj9', 'Dmaj9', 'Aadd9', 'Bm7', 'Gmaj7', 'Dmaj9', 'Aadd9', 'Bm7', 'Gmaj7', 'Dmaj9'];
const arpBeats = [0, 0.5, 1.5, 2.5, 3.25, 4, 4.5, 5.5, 6.5, 7.25];
const arpDegrees = [0, 2, 1, 3, 2, 4, 1, 2, 3, 1];

progression.forEach((name, phraseIndex) => {
  const start = phraseIndex * PHRASE;
  const chord = harmony[name];
  const closing = phraseIndex === 9;
  const light = phraseIndex === 6;
  const uplift = phraseIndex === 7 || phraseIndex === 8;
  pad(start === 0 ? 0 : start - 0.22, chord.pad, phraseIndex === 0 ? 0.030 : light ? 0.028 : 0.037, closing ? 4.72 : 5.70);

  if (phraseIndex === 0) {
    [[0.55, 62], [1.8, 69], [2.7, 73], [3.6, 76]].forEach(([offset, note], i) =>
      pluck(offset, note, 0.045 + i * 0.008, i % 2 ? 0.30 : -0.36, 2.2));
    bass(2.4, 38, 1.7, 0.075);
    airSwell(4.8, 1.35, 0.055);
    return;
  }

  if (phraseIndex === 1) {
    const signature = [[0, 74], [0.30, 81], [0.60, 78], [1.05, 76], [1.50, 78]];
    signature.forEach(([offset, note], index) => chime(start + offset, note, index === 0 ? 0.125 : 0.105, -0.24 + index * 0.12));
    bass(start, chord.root, 1.55, 0.12);
    bass(start + 2.4, chord.root, 1.4, 0.12);
    [3.0, 3.6, 4.2].forEach((offset, index) => pluck(start + offset, chord.plucks[index], 0.073, index % 2 ? 0.24 : -0.24));
    [4, 5, 6, 7].forEach((beat) => hat(start + beat * BEAT, 0.021, -0.26));
    airSwell(9.6, 1.4, 0.08);
    return;
  }

  if (closing) {
    kick(start, 0.27);
    hat(start + 0.3, 0.026);
    bass(start, chord.root, 1.0, 0.135);
    pluck(start, 69, 0.080, -0.27);
    pluck(start + 0.6, 73, 0.066, 0.27);
    [[44.4, 81], [44.7, 78], [45.0, 76], [45.6, 74]].forEach(([time, note], index) =>
      chime(time, note, index === 3 ? 0.15 : 0.105, [0.22, -0.16, 0.16, 0][index], index === 3 ? 2.2 : 2.5));
    chime(45.61, 86, 0.035, 0.25, 2.1);
    bass(45.6, 38, 1.7, 0.09);
    return;
  }

  const kicks = light ? [0, 4] : uplift ? [0, 2, 3.5, 4, 6, 7.5] : [0, 2, 4, 6, 7.5];
  kicks.forEach((beat, index) => kick(start + beat * BEAT, (light ? 0.21 : 0.30) * (index % 3 === 2 ? 0.84 : 1)));
  if (!light) [1, 3, 5, 7].forEach((beat) => clap(start + beat * BEAT + 0.008, uplift ? 0.125 : 0.108));
  const hatStep = light ? 1 : 0.5;
  for (let beat = 0.5; beat < 8; beat += hatStep) {
    const offbeat = beat % 1 !== 0;
    hat(start + beat * BEAT + (offbeat ? 0.008 : 0), (light ? 0.022 : 0.039) * (offbeat ? 1 : 0.63), offbeat ? 0.32 : -0.30, uplift && beat === 7.5);
  }
  const bassBeats = light ? [0, 3, 4, 6.5] : [0, 1.5, 3, 4, 5.5, 7];
  bassBeats.forEach((beat, index) => bass(start + beat * BEAT, chord.root + (index === 4 ? 7 : 0), index % 3 === 0 ? 0.76 : 0.47, light ? 0.115 : 0.16));
  arpBeats.forEach((beat, index) => {
    if (light && index % 2 !== 0) return;
    const note = chord.plucks[arpDegrees[(index + (phraseIndex === 8 ? 2 : 0)) % arpDegrees.length]];
    pluck(start + beat * BEAT + (index % 2 ? 0.006 : 0), note, (light ? 0.064 : uplift ? 0.094 : 0.082) * (index % 3 === 0 ? 1 : 0.78), index % 2 ? 0.38 : -0.36);
  });
});

const melodicLines = [
  {phrase: 2, beats: [2, 3.5, 6], notes: [76, 73, 71]},
  {phrase: 3, beats: [0, 1.5, 3, 5, 6.5], notes: [74, 78, 76, 74, 71]},
  {phrase: 4, beats: [0, 1.5, 3, 5.5], notes: [71, 74, 78, 76]},
  {phrase: 5, beats: [0, 1, 2.5, 4, 6], notes: [78, 76, 73, 69, 74]},
  {phrase: 6, beats: [1, 4], notes: [76, 71]},
  {phrase: 7, beats: [0, 1.5, 3, 4.5, 6.5], notes: [78, 81, 78, 76, 74]},
  {phrase: 8, beats: [0, 1.5, 3, 4.5, 6], notes: [78, 79, 78, 74, 71]},
];
melodicLines.forEach(({phrase, beats, notes}) => {
  beats.forEach((beat, index) => melody(phrase * PHRASE + beat * BEAT, notes[index], phrase === 6 ? 0.046 : phrase >= 7 ? 0.072 : 0.061, index % 2 ? 0.13 : -0.12, 1.8));
});
[19.2, 28.8, 33.6, 38.4, 43.2].forEach((time) => airSwell(time, time === 33.6 ? 1.8 : 1.2, time === 28.8 ? 0.045 : 0.065));

// The ping-pong taps are timed to eighth notes and dotted eighth notes.
const delayTaps = [[0.30, 0.30], [0.45, 0.18], [0.60, 0.13], [0.90, 0.085], [1.20, 0.040]];
for (const [seconds, gain] of delayTaps) {
  const offset = Math.round(seconds * SAMPLE_RATE);
  for (let frame = offset; frame < FRAMES; frame++) {
    const l = delayRight[frame - offset] * gain;
    const r = delayLeft[frame - offset] * gain;
    left[frame] += l;
    right[frame] += r;
    reverbLeft[frame] += l * 0.24;
    reverbRight[frame] += r * 0.24;
  }
}

function reverberate(input, otherInput, output, rightChannel) {
  const lengths = rightChannel ? [0.0449, 0.0553, 0.0641, 0.0739, 0.0817, 0.0911] : [0.0437, 0.0531, 0.0617, 0.0713, 0.0797, 0.0899];
  const combs = lengths.map((length, index) => ({
    buffer: new Float32Array(Math.round(length * SAMPLE_RATE)),
    position: 0,
    damped: 0,
    feedback: 0.73 + index * 0.013,
  }));
  const allpasses = [rightChannel ? 0.0081 : 0.0073, rightChannel ? 0.0127 : 0.0111].map((length) => ({
    buffer: new Float32Array(Math.round(length * SAMPLE_RATE)), position: 0,
  }));
  const early = [[0.017, 0.13], [0.031, 0.095], [0.047, 0.070], [0.073, 0.045]].map(([time, gain]) => [Math.round(time * SAMPLE_RATE), gain]);
  for (let frame = 0; frame < FRAMES; frame++) {
    const source = input[frame] * 0.82 + otherInput[frame] * 0.18;
    let wet = 0;
    for (const comb of combs) {
      const delayed = comb.buffer[comb.position];
      comb.damped += 0.21 * (delayed - comb.damped);
      comb.buffer[comb.position] = source + comb.damped * comb.feedback;
      comb.position = (comb.position + 1) % comb.buffer.length;
      wet += delayed / combs.length;
    }
    for (const allpass of allpasses) {
      const delayed = allpass.buffer[allpass.position];
      const diffused = delayed - wet * 0.5;
      allpass.buffer[allpass.position] = wet + diffused * 0.5;
      allpass.position = (allpass.position + 1) % allpass.buffer.length;
      wet = diffused;
    }
    for (const [offset, gain] of early) {
      if (frame >= offset) wet += input[frame - offset] * gain;
    }
    output[frame] += wet * 0.52;
  }
}
reverberate(reverbLeft, reverbRight, left, false);
reverberate(reverbRight, reverbLeft, right, true);

const dcCoefficient = Math.exp((-TAU * 18) / SAMPLE_RATE);
const lowpassCoefficient = 1 - Math.exp((-TAU * 16_000) / SAMPLE_RATE);
for (const channel of [left, right]) {
  let previous = 0;
  let highpassed = 0;
  let lowpassed = 0;
  for (let frame = 0; frame < FRAMES; frame++) {
    const raw = channel[frame];
    highpassed = raw - previous + dcCoefficient * highpassed;
    previous = raw;
    lowpassed += lowpassCoefficient * (highpassed - lowpassed);
    const time = frame / SAMPLE_RATE;
    const fade = smooth(time / 0.10) * (1 - smooth((time - 46.2) / 1.6));
    channel[frame] = Math.tanh(lowpassed * 1.12) * fade;
  }
}

let rawPeak = 0;
for (let frame = 0; frame < FRAMES; frame++) rawPeak = Math.max(rawPeak, Math.abs(left[frame]), Math.abs(right[frame]));
const masterGain = 0.86 / rawPeak;
const dataBytes = FRAMES * 2 * 2;
const wav = Buffer.alloc(44 + dataBytes);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + dataBytes, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(SAMPLE_RATE, 24);
wav.writeUInt32LE(SAMPLE_RATE * 4, 28);
wav.writeUInt16LE(4, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(dataBytes, 40);
for (let frame = 0; frame < FRAMES; frame++) {
  for (let channel = 0; channel < 2; channel++) {
    const sample = (channel === 0 ? left : right)[frame] * masterGain;
    // Dither only non-silent audio; retain the exact silent tail from 47.8 s.
    const dither = sample === 0 ? 0 : random() - random();
    const pcm = Math.round(sample * 32767 + dither);
    wav.writeInt16LE(clamp(pcm, -32768, 32767), 44 + frame * 4 + channel * 2);
  }
}

function statistics(start = 0, end = DURATION) {
  let peak = 0;
  let sumSquares = 0;
  let sumLeft = 0;
  let sumRight = 0;
  let cross = 0;
  let squareLeft = 0;
  let squareRight = 0;
  const first = Math.round(start * SAMPLE_RATE);
  const last = Math.round(end * SAMPLE_RATE);
  for (let frame = first; frame < last; frame++) {
    const l = wav.readInt16LE(44 + frame * 4) / 32768;
    const r = wav.readInt16LE(46 + frame * 4) / 32768;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sumSquares += l * l + r * r;
    sumLeft += l;
    sumRight += r;
    cross += l * r;
    squareLeft += l * l;
    squareRight += r * r;
  }
  const frames = last - first;
  const rms = Math.sqrt(sumSquares / (frames * 2));
  return {
    startSeconds: start, endSeconds: end,
    peak: Number(peak.toFixed(8)),
    peakDbfs: Number((20 * Math.log10(Math.max(peak, 1e-12))).toFixed(3)),
    rms: Number(rms.toFixed(8)),
    rmsDbfs: Number((20 * Math.log10(Math.max(rms, 1e-12))).toFixed(3)),
    dcLeft: Number((sumLeft / frames).toFixed(10)),
    dcRight: Number((sumRight / frames).toFixed(10)),
    stereoCorrelation: Number((cross / Math.sqrt(squareLeft * squareRight || 1)).toFixed(5)),
  };
}

const overall = statistics();
const silentTail = statistics(47.8, 48);
if (overall.peak > 0.9 || Math.abs(overall.dcLeft) > 0.0001 || Math.abs(overall.dcRight) > 0.0001 || silentTail.peak !== 0) {
  throw new Error(`Master validation failed: ${JSON.stringify({overall, silentTail})}`);
}
const scenes = [
  [0, 4.8, 'Suspense and warm atmosphere'],
  [4.8, 9.6, 'Brand signature and anticipation'],
  [9.6, 19.2, 'Confident product groove'],
  [19.2, 28.8, 'Warm forward momentum'],
  [28.8, 33.6, 'Lighter breathing space'],
  [33.6, 38.4, 'First uplift'],
  [38.4, 44.4, 'Final uplift and turn toward home'],
  [44.4, 48, 'Resolved musical logo and fade'],
].map(([start, end, description]) => ({description, ...statistics(start, end)}));
const metadata = {
  title: 'MyHKU — A Brighter Everyday',
  composition: 'Original procedural composition and synthesis; no samples, external assets, network calls, or services.',
  generator: 'scripts/generate-score.mjs',
  randomSeed: SEED,
  durationSeconds: DURATION,
  sampleRate: SAMPLE_RATE,
  channels: 2,
  bitsPerSample: 16,
  encoding: 'WAVE / little-endian signed PCM',
  frames: FRAMES,
  fileBytes: wav.length,
  bpm: BPM,
  meter: '4/4',
  key: 'D major',
  phraseSeconds: PHRASE,
  chordProgression: progression,
  filmSceneBoundariesSeconds: [0, 4.8, 9.6, 19.2, 28.8, 33.6, 38.4, 48],
  logoStartSeconds: 44.4,
  fadeStartSeconds: 46.2,
  silentFromSeconds: 47.8,
  instruments: eventCounts,
  mastering: {targetPeak: 0.86, dcHighpassHz: 18, trebleLowpassHz: 16000, tpdfDither: true},
  statistics: overall,
  silentTail,
  scenes,
};
mkdirSync(outputDirectory, {recursive: true});
const audioPath = resolve(outputDirectory, 'myhku-original.wav');
const metadataPath = resolve(outputDirectory, 'myhku-original.json');
writeFileSync(audioPath, wav);
writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`WAV: ${audioPath}`);
console.log(`Metadata: ${metadataPath}`);
console.log(`Duration: ${DURATION.toFixed(3)} s | ${SAMPLE_RATE} Hz | stereo | 16-bit PCM | ${FRAMES} frames`);
console.log(`Peak: ${overall.peak.toFixed(6)} (${overall.peakDbfs} dBFS) | RMS: ${overall.rms.toFixed(6)} (${overall.rmsDbfs} dBFS)`);
console.log(`DC: L ${overall.dcLeft}, R ${overall.dcRight} | stereo correlation: ${overall.stereoCorrelation}`);
console.log(`Silent tail: ${silentTail.startSeconds.toFixed(1)}–${silentTail.endSeconds.toFixed(1)} s | bytes: ${wav.length}`);
