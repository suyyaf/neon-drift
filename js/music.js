/* NEON DRIFT — music: procedural synthwave soundtrack.
 *
 * Everything is synthesised at runtime with WebAudio, so the game still ships
 * with zero asset files. A lookahead scheduler queues notes slightly ahead of
 * the audio clock, which keeps timing tight even when frames hitch.
 *
 *   menu   - slow, atmospheric intro
 *   track  - the main synthwave loop (drums, bass, arp, pad)
 *   boss   - faster, darker variant with a driving pulse
 *   over   - sparse, decaying outro
 */
(function (ND) {
  'use strict';

  const LOOKAHEAD = 0.12;   // seconds of audio scheduled in advance
  const TICK = 25;          // scheduler wake-up interval, ms

  // A minor is the classic synthwave key. Frequencies via MIDI note numbers.
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // i - VI - III - VII in A minor: a driving, cinematic loop.
  const PROG = [
    [57, 60, 64], // Am
    [53, 57, 60], // F
    [48, 52, 55], // C
    [55, 59, 62]  // G
  ];

  const TRACKS = {
    menu: {
      bpm: 84,
      steps: 16,
      drums: 0.35,
      bass: 0.5,
      arp: 0.32,
      pad: 0.75,
      kick: [0, 8],
      snare: [],
      hat: [4, 12],
      arpWave: 'triangle',
      bassWave: 'sine',
      padWave: 'sawtooth',
      arpOct: 12,
      arpGate: 0.9,
      swing: 0.04
    },
    track: {
      bpm: 116,
      steps: 16,
      drums: 0.85,
      bass: 0.85,
      arp: 0.5,
      pad: 0.5,
      kick: [0, 4, 8, 12],
      snare: [4, 12],
      hat: [2, 6, 10, 14],
      arpWave: 'square',
      bassWave: 'sawtooth',
      padWave: 'sawtooth',
      arpOct: 12,
      arpGate: 0.55,
      swing: 0.02
    },
    boss: {
      bpm: 140,
      steps: 16,
      drums: 1,
      bass: 1,
      arp: 0.62,
      pad: 0.45,
      kick: [0, 2, 4, 6, 8, 10, 12, 14],
      snare: [4, 12],
      hat: [1, 3, 5, 7, 9, 11, 13, 15],
      arpWave: 'sawtooth',
      bassWave: 'square',
      padWave: 'sawtooth',
      arpOct: 24,
      arpGate: 0.35,
      swing: 0
    },
    over: {
      bpm: 62,
      steps: 16,
      drums: 0.2,
      bass: 0.4,
      arp: 0.22,
      pad: 0.85,
      kick: [0],
      snare: [],
      hat: [],
      arpWave: 'sine',
      bassWave: 'sine',
      padWave: 'triangle',
      arpOct: 12,
      arpGate: 1.4,
      swing: 0.06
    }
  };

  class Music {
    constructor() {
      this.ctx = null;
      this.bus = null;        // music-only gain, separate from SFX
      this.filter = null;
      this.timer = null;
      this.current = null;
      this.pending = null;
      this.step = 0;
      this.nextNoteTime = 0;
      this.enabled = true;
      this.volume = 0.5;
      this.intensity = 1;     // scales drum/bass energy with wave count
    }

    attach(ctx, destination) {
      if (this.ctx) return;
      this.ctx = ctx;
      this.bus = ctx.createGain();
      this.bus.gain.value = this.enabled ? this.volume : 0;

      // A gentle lowpass keeps the synth from sounding harsh on laptop speakers.
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 5200;
      this.filter.Q.value = 0.6;

      this.bus.connect(this.filter);
      this.filter.connect(destination);
    }

    setEnabled(on) {
      this.enabled = on;
      if (this.bus && this.ctx) {
        const t = this.ctx.currentTime;
        this.bus.gain.cancelScheduledValues(t);
        this.bus.gain.setTargetAtTime(on ? this.volume : 0, t, 0.06);
      }
    }

    setVolume(v) {
      this.volume = ND.clamp(v, 0, 1);
      if (this.bus && this.ctx) {
        this.bus.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.05);
      }
    }

    // Crossfade to a named track. Re-requesting the current track is a no-op.
    play(name) {
      if (!TRACKS[name]) return;
      if (this.current === name) return;
      if (!this.ctx) {
        this.pending = name;
        return;
      }
      this.current = name;
      this.pending = null;
      this.step = 0;
      this.nextNoteTime = this.ctx.currentTime + 0.06;
      this.start();
    }

    start() {
      if (this.timer) return;
      this.timer = setInterval(() => this.schedule(), TICK);
    }

    stop() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.current = null;
    }

    // Queue every step whose time falls inside the lookahead window.
    schedule() {
      if (!this.ctx || !this.current) return;
      const track = TRACKS[this.current];
      const stepDur = (60 / track.bpm) / 4; // 16th notes

      let guard = 0;
      while (this.nextNoteTime < this.ctx.currentTime + LOOKAHEAD && guard++ < 32) {
        const swingOffset = (this.step % 2 === 1) ? stepDur * track.swing : 0;
        const t = this.nextNoteTime + swingOffset;
        this.stepNote(track, this.step % track.steps, t);
        this.nextNoteTime += stepDur;
        this.step++;
      }
    }

    stepNote(track, step, time) {
      const bar = Math.floor(this.step / track.steps) % PROG.length;
      const chord = PROG[bar];
      const s = step % track.steps;
      const inten = this.intensity;

      if (track.kick.indexOf(s) !== -1) this.kick(time, track.drums * inten);
      if (track.snare.indexOf(s) !== -1) this.snare(time, track.drums * inten);
      if (track.hat.indexOf(s) !== -1) this.hat(time, track.drums * 0.45 * inten);

      // Bass on the downbeats and offbeat eighths.
      if (s % 2 === 0 || track === TRACKS.boss) {
        const note = chord[0] - 12;
        this.bass(time, mtof(note), track.bass * inten, track.bassWave);
      }

      // Arpeggio climbs the chord, two octaves up.
      const arpIdx = s % chord.length;
      const arpNote = chord[arpIdx] + track.arpOct;
      this.arp(time, mtof(arpNote), track.arp * (0.7 + inten * 0.3), track.arpWave, track.arpGate);

      // Pad lands once per bar and holds.
      if (s === 0) {
        const barDur = (60 / track.bpm) * 4;
        this.pad(time, chord, track.pad, barDur, track.padWave);
      }
    }

    // ---------- voices ----------

    kick(time, vol) {
      if (vol <= 0.01) return;
      const c = this.ctx;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(46, time + 0.12);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.55 * vol, time + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.26);
      osc.connect(g); g.connect(this.bus);
      osc.start(time); osc.stop(time + 0.3);
    }

    snare(time, vol) {
      if (vol <= 0.01) return;
      const c = this.ctx;
      // noise body
      const src = c.createBufferSource();
      src.buffer = ND.noiseBuffer;
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 0.9;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.3 * vol, time + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
      src.connect(bp); bp.connect(g); g.connect(this.bus);
      src.start(time); src.stop(time + 0.2);

      // short tonal crack
      const osc = c.createOscillator();
      const g2 = c.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, time);
      osc.frequency.exponentialRampToValueAtTime(120, time + 0.08);
      g2.gain.setValueAtTime(0.0001, time);
      g2.gain.exponentialRampToValueAtTime(0.12 * vol, time + 0.005);
      g2.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);
      osc.connect(g2); g2.connect(this.bus);
      osc.start(time); osc.stop(time + 0.12);
    }

    hat(time, vol) {
      if (vol <= 0.01) return;
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = ND.noiseBuffer;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7500;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.13 * vol, time + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
      src.connect(hp); hp.connect(g); g.connect(this.bus);
      src.start(time); src.stop(time + 0.07);
    }

    bass(time, freq, vol, wave) {
      if (vol <= 0.01) return;
      const c = this.ctx;
      const osc = c.createOscillator();
      const g = c.createGain();
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(420, time);
      lp.frequency.exponentialRampToValueAtTime(180, time + 0.18);

      osc.type = wave || 'sawtooth';
      osc.frequency.setValueAtTime(freq, time);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.22 * vol, time + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);

      osc.connect(lp); lp.connect(g); g.connect(this.bus);
      osc.start(time); osc.stop(time + 0.25);
    }

    arp(time, freq, vol, wave, gate) {
      if (vol <= 0.01) return;
      const c = this.ctx;
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = wave || 'square';
      osc.frequency.setValueAtTime(freq, time);

      const dur = Math.max(0.05, gate * 0.09);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.085 * vol, time + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

      osc.connect(g); g.connect(this.bus);
      osc.start(time); osc.stop(time + dur + 0.02);
    }

    pad(time, chord, vol, dur, wave) {
      if (vol <= 0.01) return;
      const c = this.ctx;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.05 * vol, time + 0.6);
      g.gain.linearRampToValueAtTime(0.0001, time + dur);

      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;

      // Detune the stack slightly for a wide, cheap chorus effect.
      chord.forEach((note, i) => {
        const osc = c.createOscillator();
        osc.type = wave || 'sawtooth';
        osc.frequency.setValueAtTime(mtof(note), time);
        osc.detune.setValueAtTime((i - 1) * 7, time);
        osc.connect(lp);
        osc.start(time);
        osc.stop(time + dur + 0.1);
      });

      lp.connect(g); g.connect(this.bus);
    }
  }

  ND.music = new Music();
})(window.ND);
