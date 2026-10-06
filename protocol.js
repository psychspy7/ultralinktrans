/* ULTRALINK protocol + audio modem. No backend required. */
(function (root) {
  'use strict';

  const CFG = Object.freeze({
    sampleRate: 48000,
    freq0: 18000,
    freq1: 19400,
    symbolMs: 20,
    pilotSymbols: 12,
    markerSymbols: 6,
    guardSymbols: 3,
    leadSymbols: 6,
    tailSymbols: 5,
    maxPayloadBytes: 320,
    amplitude: 0.72,
    magic: [0x55, 0x4c, 0x4e, 0x4b], // ULNK
    version: 1
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: false });

  function crc16(bytes) {
    let crc = 0xffff;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i] << 8;
      for (let b = 0; b < 8; b++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc & 0xffff;
  }

  function makeFrame(text) {
    const payload = encoder.encode(text);
    if (!payload.length) throw new Error('Type a message first.');
    if (payload.length > CFG.maxPayloadBytes) {
      throw new Error(`Message is ${payload.length} bytes. Maximum is ${CFG.maxPayloadBytes} UTF-8 bytes.`);
    }
    const frame = new Uint8Array(4 + 1 + 2 + payload.length + 2);
    frame.set(CFG.magic, 0);
    frame[4] = CFG.version;
    frame[5] = (payload.length >>> 8) & 0xff;
    frame[6] = payload.length & 0xff;
    frame.set(payload, 7);
    const crc = crc16(frame.subarray(0, frame.length - 2));
    frame[frame.length - 2] = (crc >>> 8) & 0xff;
    frame[frame.length - 1] = crc & 0xff;
    return { frame, payload, crc };
  }

  function parseFrame(frame) {
    if (!(frame instanceof Uint8Array)) frame = new Uint8Array(frame);
    if (frame.length < 9) throw new Error('Packet is too short.');
    for (let i = 0; i < 4; i++) if (frame[i] !== CFG.magic[i]) throw new Error('ULNK header not found.');
    if (frame[4] !== CFG.version) throw new Error(`Unsupported ULNK version ${frame[4]}.`);
    const length = (frame[5] << 8) | frame[6];
    if (length > CFG.maxPayloadBytes) throw new Error('Payload length is outside protocol limits.');
    const expected = 7 + length + 2;
    if (frame.length < expected) throw new Error('Packet ended before the complete payload arrived.');
    const packet = frame.subarray(0, expected);
    const storedCrc = (packet[expected - 2] << 8) | packet[expected - 1];
    const actualCrc = crc16(packet.subarray(0, expected - 2));
    if (storedCrc !== actualCrc) throw new Error('Checksum mismatch. The audio packet is damaged or incomplete.');
    const payload = packet.subarray(7, 7 + length);
    return { text: decoder.decode(payload), payload, crc: storedCrc, frame: packet };
  }

  function bytesToBits(bytes) {
    const bits = new Uint8Array(bytes.length * 8);
    let p = 0;
    for (const byte of bytes) {
      for (let bit = 7; bit >= 0; bit--) bits[p++] = (byte >>> bit) & 1;
    }
    return bits;
  }

  function bitsToBytes(bits, byteCount) {
    const out = new Uint8Array(byteCount);
    for (let i = 0; i < byteCount; i++) {
      let value = 0;
      for (let bit = 0; bit < 8; bit++) value = (value << 1) | (bits[i * 8 + bit] || 0);
      out[i] = value;
    }
    return out;
  }

  function makeSignal(frame, sampleRate = CFG.sampleRate) {
    const symbol = Math.max(64, Math.round(sampleRate * CFG.symbolMs / 1000));
    const bits = bytesToBits(frame);
    const totalSymbols = CFG.leadSymbols + CFG.pilotSymbols + CFG.markerSymbols + CFG.guardSymbols + bits.length + CFG.tailSymbols;
    const samples = new Float32Array(totalSymbols * symbol);
    let cursor = CFG.leadSymbols * symbol;

    function writeTone(freq, countSymbols, amp = CFG.amplitude) {
      const length = countSymbols * symbol;
      const fade = Math.max(16, Math.round(Math.min(symbol * 0.09, sampleRate * 0.0018)));
      for (let i = 0; i < length; i++) {
        const local = i % symbol;
        let env = 1;
        if (local < fade) env = local / fade;
        else if (local >= symbol - fade) env = (symbol - 1 - local) / fade;
        env = Math.max(0, Math.min(1, env));
        samples[cursor + i] = Math.sin(2 * Math.PI * freq * i / sampleRate) * amp * env;
      }
      cursor += length;
    }

    writeTone(CFG.freq0, CFG.pilotSymbols, CFG.amplitude * 0.86);
    writeTone(CFG.freq1, CFG.markerSymbols, CFG.amplitude * 0.86);
    cursor += CFG.guardSymbols * symbol;
    for (let i = 0; i < bits.length; i++) writeTone(bits[i] ? CFG.freq1 : CFG.freq0, 1);
    return { samples, sampleRate, symbolSamples: symbol, bits };
  }

  function wavArrayBuffer(floatSamples, sampleRate = CFG.sampleRate) {
    const bytesPerSample = 2;
    const buffer = new ArrayBuffer(44 + floatSamples.length * bytesPerSample);
    const view = new DataView(buffer);
    function str(offset, s) { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); }
    str(0, 'RIFF');
    view.setUint32(4, 36 + floatSamples.length * 2, true);
    str(8, 'WAVE'); str(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, floatSamples.length * 2, true);
    let o = 44;
    for (let i = 0; i < floatSamples.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, floatSamples[i]));
      view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  function mp3Blob(floatSamples, sampleRate = CFG.sampleRate, kbps = 320) {
    if (!root.lamejs || !root.lamejs.Mp3Encoder) throw new Error('MP3 encoder could not load. WAV download is still available.');
    const encoderMp3 = new root.lamejs.Mp3Encoder(1, sampleRate, kbps);
    const block = 1152;
    const pcm = new Int16Array(floatSamples.length);
    for (let i = 0; i < floatSamples.length; i++) {
      const s = Math.max(-1, Math.min(1, floatSamples[i]));
      pcm[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    }
    const parts = [];
    for (let i = 0; i < pcm.length; i += block) {
      const encoded = encoderMp3.encodeBuffer(pcm.subarray(i, Math.min(i + block, pcm.length)));
      if (encoded.length) parts.push(new Uint8Array(encoded));
    }
    const tail = encoderMp3.flush();
    if (tail.length) parts.push(new Uint8Array(tail));
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  function goertzelPower(samples, start, length, freq, sampleRate) {
    start = Math.max(0, start | 0);
    const end = Math.min(samples.length, start + (length | 0));
    const n = end - start;
    if (n < 32) return 0;
    const omega = 2 * Math.PI * freq / sampleRate;
    const coeff = 2 * Math.cos(omega);
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = start; i < end; i++) {
      // Hann-ish window to reduce leakage while keeping this cheap.
      const pos = (i - start) / Math.max(1, n - 1);
      const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * pos);
      s0 = samples[i] * win + coeff * s1 - s2;
      s2 = s1; s1 = s0;
    }
    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    return Math.max(0, power) / (n * n);
  }

  function carrierDecision(samples, start, length, sampleRate) {
    const p0 = goertzelPower(samples, start, length, CFG.freq0, sampleRate);
    const p1 = goertzelPower(samples, start, length, CFG.freq1, sampleRate);
    const total = p0 + p1;
    if (total < 0.00008) return { bit: -1, p0, p1, confidence: 0 };
    const hi = Math.max(p0, p1), lo = Math.min(p0, p1) + 1e-12;
    const ratio = hi / lo;
    if (ratio < 1.45) return { bit: -1, p0, p1, confidence: Math.min(1, (ratio - 1) / 1.5) };
    return { bit: p1 > p0 ? 1 : 0, p0, p1, confidence: Math.min(1, (ratio - 1) / 4) };
  }

  function decodeAt(samples, sampleRate, dataStart, symbol) {
    const readWindow = Math.max(64, Math.round(symbol * 0.72));
    const inset = Math.round((symbol - readWindow) / 2);

    function readBits(count) {
      const bits = new Uint8Array(count);
      let conf = 0;
      for (let i = 0; i < count; i++) {
        const at = Math.round(dataStart + i * symbol + inset);
        if (at + readWindow > samples.length) return null;
        const d = carrierDecision(samples, at, readWindow, sampleRate);
        if (d.bit < 0) return null;
        bits[i] = d.bit;
        conf += d.confidence;
      }
      return { bits, confidence: conf / Math.max(1, count) };
    }

    const headerRead = readBits(56);
    if (!headerRead) return null;
    const header = bitsToBytes(headerRead.bits, 7);
    for (let i = 0; i < 4; i++) if (header[i] !== CFG.magic[i]) return null;
    if (header[4] !== CFG.version) return null;
    const payloadLen = (header[5] << 8) | header[6];
    if (payloadLen > CFG.maxPayloadBytes) return null;
    const totalBytes = 7 + payloadLen + 2;
    const allRead = readBits(totalBytes * 8);
    if (!allRead) return null;
    const bytes = bitsToBytes(allRead.bits, totalBytes);
    try {
      const parsed = parseFrame(bytes);
      return { ...parsed, confidence: allRead.confidence, dataStart };
    } catch (_) {
      return null;
    }
  }

  function decodeSamples(samples, sampleRate, options = {}) {
    if (!(samples instanceof Float32Array)) samples = new Float32Array(samples);
    if (!sampleRate || sampleRate < 40000) throw new Error('Audio sample rate is too low for the 18–19.4 kHz carriers.');
    const symbol = Math.max(64, Math.round(sampleRate * CFG.symbolMs / 1000));
    if (samples.length < symbol * (CFG.pilotSymbols + CFG.markerSymbols + CFG.guardSymbols + 72)) {
      throw new Error('Audio is too short to contain a complete ULNK packet.');
    }

    const step = Math.max(32, Math.round(symbol / 4));
    const win = Math.max(64, Math.round(symbol * 0.72));
    const count = Math.floor((samples.length - win) / step);
    const cls = new Int8Array(count);
    const conf = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const d = carrierDecision(samples, i * step, win, sampleRate);
      cls[i] = d.bit;
      conf[i] = d.confidence;
    }

    const pilotSteps = CFG.pilotSymbols * 4;
    const markerSteps = CFG.markerSymbols * 4;
    const minPilotHits = Math.floor(pilotSteps * 0.55);
    const minMarkerHits = Math.floor(markerSteps * 0.50);
    const candidates = [];

    for (let j = pilotSteps; j < count - markerSteps; j++) {
      // j approximates the 0 -> 1 pilot/marker transition.
      let pHits = 0, mHits = 0, csum = 0;
      for (let k = Math.max(0, j - pilotSteps); k < j - 2; k++) {
        if (cls[k] === 0) { pHits++; csum += conf[k]; }
      }
      if (pHits < minPilotHits) continue;
      for (let k = j + 2; k < Math.min(count, j + markerSteps); k++) {
        if (cls[k] === 1) { mHits++; csum += conf[k]; }
      }
      if (mHits < minMarkerHits) continue;
      const score = pHits + mHits + csum * 0.3;
      candidates.push({ markerStart: j * step, score });
      j += Math.max(1, Math.floor(markerSteps / 2));
    }

    candidates.sort((a, b) => b.score - a.score);
    const maxCandidates = options.maxCandidates || 18;
    const shifts = [-0.50, -0.375, -0.25, -0.125, 0, 0.125, 0.25, 0.375, 0.50];

    for (let ci = 0; ci < Math.min(maxCandidates, candidates.length); ci++) {
      const c = candidates[ci];
      const nominal = c.markerStart + (CFG.markerSymbols + CFG.guardSymbols) * symbol;
      for (const sh of shifts) {
        const result = decodeAt(samples, sampleRate, nominal + sh * symbol, symbol);
        if (result) return { ...result, markerStart: c.markerStart, sampleRate, symbolSamples: symbol };
      }
    }

    throw new Error(candidates.length ? 'ULNK signal found, but the payload could not pass checksum validation.' : 'No ULNK pilot/marker sequence was detected in this audio.');
  }

  root.UltraProtocol = Object.freeze({
    CFG, crc16, makeFrame, parseFrame, bytesToBits, bitsToBytes,
    makeSignal, wavArrayBuffer, mp3Blob, goertzelPower, carrierDecision, decodeSamples
  });
})(typeof window !== 'undefined' ? window : globalThis);
