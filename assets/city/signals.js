// Synthetic DAS-like signals, not recorded or physically calibrated measurements.
// A single sampled stream drives the waveform, RMS reading and STFT display.
export const SAMPLE_RATE = 256;
const FFT_SIZE = 256;
const TAU = 2 * Math.PI;

function random(index, seed) {
  let h = Math.imul(index | 0, 374761393) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(t, rate, seed) {
  const p = t * rate, i = Math.floor(p), f = p - i;
  const blend = f * f * (3 - 2 * f);
  return (random(i, seed) * (1 - blend) + random(i + 1, seed) * blend) * 2 - 1;
}
export function assetSeed(id) {
  let seed = 2166136261;
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}

// Illustrative operating backgrounds, not measured signatures of these assets.
const BACKGROUNDS = {
  water: { noise: .060, hz: 18, tone: .055, spacing: 3.1, pulse: .20, decay: .42 },
  gas: { noise: .045, hz: 24, tone: .030, spacing: 4.7, pulse: .13, decay: .24 },
  heat: { noise: .052, hz: 30, tone: .062, spacing: 3.8, pulse: .18, decay: .48 },
  drain: { noise: .080, hz: 11, tone: .038, spacing: 2.8, pulse: .24, decay: .60 },
  bridge: { noise: .047, hz: 7, tone: .044, spacing: 3.0, pulse: .34, decay: .83 },
};
export function createSignalSource(seed, kind = 'background', start = -Infinity, assetType = 'gas') {
  const samples = new Map(), spectra = new Map();
  const profile = BACKGROUNDS[assetType] || BACKGROUNDS.gas;
  function synthesize(index) {
    const t = index / SAMPLE_RATE;
    const gain = .82 + .34 * random(17, seed);
    // Mixed time scales yield colored noise and a slow, irregular noise floor.
    let value = (.022 * noise(t, 95, seed) + .018 * noise(t, 27, seed + 31)
      + .010 * noise(t, 7, seed + 71)) * (1 + .24 * noise(t, .7, seed + 82));
    // Persistent, colored operating noise with wandering amplitude and phase.
    // Quiet intervals remain quiet; normal background activity is not an alarm.
    const envelope = .85 + .36 * noise(t, .38, seed + 501) + .18 * noise(t, 1.2, seed + 502);
    const hz = profile.hz * (.88 + .25 * random(25, seed));
    const phase = TAU * hz * t + 1.3 * noise(t, .55, seed + 503);
    const colored = .64 * noise(t, 72, seed + 504) + .48 * noise(t, 19, seed + 505);
    if (assetType === 'water') {
      const pumpLoad = .70 + .32 * noise(t, .27, seed + 506);
      value += envelope * profile.noise * colored
        + pumpLoad * profile.tone * (Math.sin(phase) + .38 * Math.sin(2 * phase));
    } else if (assetType === 'heat') {
      // A steadier narrow-band component, with mild operating-load changes.
      value += .38 * profile.noise * colored
        + envelope * profile.tone * (Math.sin(phase) + .17 * Math.sin(2 * phase));
    } else if (assetType === 'drain') {
      // Flow-like broadband texture: broad swells, no permanent sine carrier.
      const flow = 1.15 + .72 * noise(t, .65, seed + 506);
      value += flow * profile.noise * (1.35 * colored + .60 * noise(t, 9, seed + 507));
    } else if (assetType === 'bridge') {
      // Relatively quiet between passing loads, not continuous machine hum.
      value += .55 * profile.noise * colored + .018 * noise(t, 4, seed + 506);
    } else {
      value += envelope * (profile.noise * colored
        + profile.tone * (Math.sin(phase) + .25 * Math.sin(1.61 * phase)));
    }
    // Uneven passing loads / flow transients: vary timing, strength and ringing.
    const backgroundSlot = Math.floor(t / profile.spacing);
    for (let k = backgroundSlot - 2; k <= backgroundSlot; k++) {
      if (random(k, seed + 510) < .16) continue;
      const age = t - (k * profile.spacing + profile.spacing * .72 * random(k, seed + 511));
      const decay = profile.decay * (.72 + .70 * random(k, seed + 512));
      if (age < 0 || age > decay * 5) continue;
      const attack = assetType === 'bridge' ? .17 : .065;
      const transient = assetType === 'bridge'
        ? Math.exp(-.5 * ((age - decay) / (decay * .48)) ** 2)
        : (1 - Math.exp(-age / attack)) * Math.exp(-age / decay);
      const strength = profile.pulse * (.55 + .90 * random(k, seed + 513));
      const transientHz = hz * (.72 + .60 * random(k, seed + 514));
      const transientTexture = assetType === 'drain'
        ? .95 * noise(t, 44, seed + k + 515) + .45 * noise(t, 12, seed + k + 516)
        : .72 * Math.sin(TAU * transientHz * age) + .56 * noise(t, 58, seed + k + 515);
      value += strength * transient * transientTexture;
    }
    if (t < start || kind === 'background') return value * gain;
    const elapsed = t - (Number.isFinite(start) ? start : 0);
    if (kind === 'construction') {
      // Irregular impacts: missing hits, variable strength, frequency and decay.
      const slot = Math.floor(elapsed / .88);
      for (let k = slot - 2; k <= slot; k++) {
        if (random(k, seed + 120) < .22) continue;
        const age = elapsed - (k * .88 + .67 * random(k, seed + 121));
        if (age < 0 || age > 1.8) continue;
        const strength = .32 + .70 * random(k, seed + 122);
        const decay = .095 + .22 * random(k, seed + 123);
        const hz = 23 + 24 * random(k, seed + 124);
        const ring = Math.sin(TAU * hz * age) + .24 * Math.sin(TAU * hz * 1.83 * age);
        value += strength * Math.exp(-age / decay) * (ring + .32 * noise(t, 110, seed + k + 400));
      }
      value += .075 * noise(t, 67, seed + 130) * (.55 + .45 * noise(t, .4, seed + 131));
    } else if (kind === 'traffic') {
      // Passing vehicles rise and recede; wheel/road impacts are not periodic.
      const slot = Math.floor(elapsed / 5.6);
      for (let k = slot - 1; k <= slot + 1; k++) {
        const age = elapsed - (k * 5.6 + 1.1 + 2.4 * random(k, seed + 210));
        const duration = .70 + .72 * random(k, seed + 211);
        const envelope = Math.exp(-.5 * (age / duration) ** 2);
        const hz = 9 + 13 * random(k, seed + 212);
        const phase = TAU * (hz * age + .45 * age * age);
        value += (.12 + .20 * random(k, seed + 213)) * envelope
          * (.58 * Math.sin(phase) + .45 * noise(t, 46, seed + 214 + k)
            + .25 * Math.sin(TAU * 3.7 * age));
      }
    } else {
      const slot = Math.floor(elapsed / 1.75);
      for (let k = slot - 1; k <= slot; k++) {
        const age = elapsed - (k * 1.75 + 1.0 * random(k, seed + 310));
        if (age < 0 || age > 2.0) continue;
        const envelope = (1 - Math.exp(-age / .035)) * Math.exp(-age / (.16 + .48 * random(k, seed + 311)));
        const hz = 16 + 37 * random(k, seed + 312);
        value += (.23 + .48 * random(k, seed + 313)) * envelope
          * (.55 * Math.sin(TAU * (hz * age + 2.3 * age * age))
            + .67 * noise(t, 100, seed + k + 314));
      }
    }
    return value * gain;
  }
  function sample(index) {
    if (!samples.has(index)) samples.set(index, synthesize(index));
    return samples.get(index);
  }
  function spectrum(endIndex) {
    if (spectra.has(endIndex)) return spectra.get(endIndex);
    const real = new Float64Array(FFT_SIZE), imag = new Float64Array(FFT_SIZE);
    let mean = 0;
    for (let i = 0; i < FFT_SIZE; i++) mean += sample(endIndex - FFT_SIZE + 1 + i);
    mean /= FFT_SIZE;
    for (let i = 0; i < FFT_SIZE; i++) {
      real[i] = (sample(endIndex - FFT_SIZE + 1 + i) - mean) * (.5 - .5 * Math.cos(TAU * i / (FFT_SIZE - 1)));
    }
    for (let i = 1, j = 0; i < FFT_SIZE; i++) {
      let bit = FFT_SIZE >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) [real[i], real[j]] = [real[j], real[i]];
    }
    for (let size = 2; size <= FFT_SIZE; size <<= 1) {
      for (let base = 0; base < FFT_SIZE; base += size) {
        for (let k = 0; k < size / 2; k++) {
          const angle = -TAU * k / size, c = Math.cos(angle), s = Math.sin(angle);
          const a = base + k, b = a + size / 2;
          const re = real[b] * c - imag[b] * s, im = real[b] * s + imag[b] * c;
          real[b] = real[a] - re; imag[b] = imag[a] - im;
          real[a] += re; imag[a] += im;
        }
      }
    }
    const power = new Float64Array(101);
    for (let i = 0; i <= 100; i++) power[i] = (real[i] ** 2 + imag[i] ** 2) / (FFT_SIZE * FFT_SIZE / 16);
    spectra.set(endIndex, power);
    return power;
  }
  function window(t) {
    const end = Math.floor(t * SAMPLE_RATE), begin = end - 8 * SAMPLE_RATE + 1;
    const values = new Float64Array(8 * SAMPLE_RATE);
    let squareSum = 0;
    for (let i = 0; i < values.length; i++) {
      values[i] = sample(begin + i);
      if (i >= values.length - SAMPLE_RATE) squareSum += values[i] ** 2;
    }
    const rms = Math.sqrt(squareSum / SAMPLE_RATE);
    // Welch average over the latest two seconds, overlapping 1-second Hann windows.
    const metricEnd = Math.floor(end / 64) * 64, averaged = new Float64Array(101);
    for (let offset = 0; offset <= 256; offset += 128) {
      const power = spectrum(metricEnd - offset);
      for (let bin = 1; bin <= 100; bin++) averaged[bin] += power[bin] / 3;
    }
    let peak = 3;
    for (let bin = 4; bin <= 99; bin++) if (averaged[bin] > averaged[peak]) peak = bin;
    const left = Math.log(averaged[peak - 1] + 1e-14), center = Math.log(averaged[peak] + 1e-14), right = Math.log(averaged[peak + 1] + 1e-14);
    const offset = Math.max(-.5, Math.min(.5, .5 * (left - right) / (left - 2 * center + right || 1)));
    const total = averaged.reduce((sum, p) => sum + p, 0);
    const coherent = (averaged[peak - 1] + averaged[peak] + averaged[peak + 1]) / (total || 1);
    const dominantHz = rms > .035 && coherent > .16 ? peak + offset : null;
    const columns = [];
    for (let cursor = Math.floor(begin / 32) * 32; cursor <= end; cursor += 32) {
      columns.push({position: (cursor - begin) / values.length, power: spectrum(cursor)});
    }
    // Bounded cache; repeated draws at a frozen time are bit-for-bit identical.
    for (const index of samples.keys()) if (index < begin - FFT_SIZE) samples.delete(index);
    for (const index of spectra.keys()) if (index < begin - FFT_SIZE) spectra.delete(index);
    // Explicit display range improves quiet-background readability without
    // changing samples, RMS or frequency. Not for comparing screen heights.
    const displayRange = kind === 'construction' || kind === 'unknown' ? 1.5
      : kind === 'traffic' ? .75
      : ({water:.35,gas:.30,heat:.32,drain:.40,bridge:.75}[assetType] || .35);
    return {values, rms, dominantHz, columns, displayRange};
  }
  return {window};
}
