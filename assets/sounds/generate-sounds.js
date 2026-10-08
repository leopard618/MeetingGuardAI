/* global __dirname, Buffer */
/**
 * Generates the bundled alert sounds (owner: alerts). Run from the repo root:
 *     node assets/sounds/generate-sounds.js
 * Output: 44.1 kHz, 16-bit PCM, mono WAV files, peak-normalized.
 *
 * - meeting_alarm.wav (~3 s, MAX): three rising A-major arpeggio bursts (A5 C#6 E6 A6) followed by
 *   a ringing E6+A6 dyad; bright harmonic timbre that cuts through noise without a harsh buzz.
 *   Ends with a short silence so it loops with a natural cadence (in-app alarm loop).
 * - meeting_chime.wav (~1.5 s, MEDIUM / LIGHT): two soft bell tones (E5 -> A5).
 *
 * File names are valid Android resource names ([a-z0-9_]) and are registered in app.config.js
 * (expo-notifications "sounds"); iOS requires notification sounds shorter than 30 s.
 */
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44_100;

function writeWav(filePath, samples) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32_767), 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

function normalize(samples, peak) {
  let max = 0;
  for (const value of samples) max = Math.max(max, Math.abs(value));
  const gain = max > 0 ? peak / max : 1;
  return samples.map((value) => value * gain);
}

/** Short fades at both ends (no clicks, clean loop point). */
function fadeEdges(samples, ms) {
  const n = Math.min(Math.floor((SAMPLE_RATE * ms) / 1000), Math.floor(samples.length / 2));
  for (let i = 0; i < n; i += 1) {
    const g = i / n;
    samples[i] *= g;
    samples[samples.length - 1 - i] *= g;
  }
  return samples;
}

/**
 * Adds a tone to `out`.
 * @param partials [ratio, amplitude][] relative to the fundamental
 * @param envelope 'beep' (flat with short attack/release) | 'bell' (exponential decay)
 */
function addTone(out, { start, duration, freq, amp, partials, envelope, decay = 0.4 }) {
  const first = Math.floor(start * SAMPLE_RATE);
  const count = Math.floor(duration * SAMPLE_RATE);
  const attack = Math.floor(0.006 * SAMPLE_RATE);
  const release = Math.floor(0.04 * SAMPLE_RATE);
  for (let i = 0; i < count && first + i < out.length; i += 1) {
    const t = i / SAMPLE_RATE;
    let env;
    if (envelope === 'bell') {
      env = (i < attack ? i / attack : 1) * Math.exp(-t / decay);
      if (i > count - release) env *= (count - i) / release;
    } else {
      env = i < attack ? i / attack : i > count - release ? (count - i) / release : 1;
    }
    let value = 0;
    for (const [ratio, partialAmp] of partials) {
      value += partialAmp * Math.sin(2 * Math.PI * freq * ratio * t);
    }
    out[first + i] += amp * env * value;
  }
}

function makeAlarm() {
  const total = 3.0;
  const out = new Array(Math.floor(total * SAMPLE_RATE)).fill(0);
  const bright = [
    [1, 1],
    [2, 0.35],
    [3, 0.15],
    [5, 0.04],
  ];
  const arpeggio = [880, 1108.73, 1318.51, 1760];
  const noteLength = 0.11;
  const noteStep = 0.14;
  const burstStep = arpeggio.length * noteStep + 0.12;
  for (let burst = 0; burst < 3; burst += 1) {
    arpeggio.forEach((freq, index) => {
      addTone(out, {
        start: burst * burstStep + index * noteStep,
        duration: noteLength,
        freq,
        amp: 0.6,
        partials: bright,
        envelope: 'beep',
      });
    });
  }
  const dyadStart = 3 * burstStep;
  for (const freq of [1318.51, 1760]) {
    addTone(out, { start: dyadStart, duration: 0.65, freq, amp: 0.5, partials: bright, envelope: 'bell', decay: 0.3 });
  }
  return fadeEdges(normalize(out, 0.891), 4); // -1 dBFS
}

function makeChime() {
  const total = 1.5;
  const out = new Array(Math.floor(total * SAMPLE_RATE)).fill(0);
  const bell = [
    [1, 1],
    [2, 0.25],
    [2.76, 0.06],
    [3, 0.08],
  ];
  addTone(out, { start: 0, duration: 1.2, freq: 659.25, amp: 0.6, partials: bell, envelope: 'bell', decay: 0.45 });
  addTone(out, { start: 0.22, duration: 1.25, freq: 880, amp: 0.6, partials: bell, envelope: 'bell', decay: 0.5 });
  return fadeEdges(normalize(out, 0.708), 60); // -3 dBFS
}

const dir = __dirname;
writeWav(path.join(dir, 'meeting_alarm.wav'), makeAlarm());
writeWav(path.join(dir, 'meeting_chime.wav'), makeChime());
console.warn('Wrote meeting_alarm.wav and meeting_chime.wav to', dir);
