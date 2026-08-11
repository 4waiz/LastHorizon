import { clamp, lerp } from '../utils/MathUtils';
import type { InteriorAudioProfile } from '../world/interiors/InteriorDefinition';

/**
 * Original soundscape, synthesised in the Web Audio API.
 *
 * Nothing is streamed from disk. Every layer — the pad, wind, cicadas, birds,
 * footsteps, the transformer hum near the poles — is generated from
 * oscillators and noise buffers at runtime. That sidesteps licensing entirely,
 * keeps the download at zero bytes, and means there is no "audio file missing"
 * failure mode to handle: if the AudioContext can't start, the game simply
 * runs silent.
 *
 * Nothing is created until the first user gesture, so autoplay policy is
 * satisfied by construction.
 */

type Surface = 'road' | 'grass';

function noiseBuffer(ctx: AudioContext, seconds: number, brown = false): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    } else {
      data[i] = white;
    }
  }
  return buf;
}

/**
 * Lo-fi chord bed: lush sevenths and ninths in a slow ii-V-I-vi loop, the
 * harmony that reads as "lo-fi" rather than "ambient drone". Voiced low and
 * close, run through a soft low-pass, with a little tape wobble on the
 * detune and a whisper of vinyl noise underneath.
 */
const CHORDS: number[][] = [
  [293.66, 440.00, 523.25, 698.46], // Dm9   D4 A4 C5 F5
  [392.00, 493.88, 587.33, 783.99], // G13   G4 B4 D5 G5
  [261.63, 392.00, 493.88, 659.26], // Cmaj7 C4 G4 B4 E5
  [220.00, 329.63, 415.30, 523.25], // Am7   A3 E4 G#4 C5
];

/** A gentle bell figure that drifts over the pad. */
const MOTIF = [523.25, 587.33, 698.46, 587.33, 523.25, 440.0];

/**
 * How loud the one indoor bed sits, per kind of room.
 *
 * Authored against the rooms rather than derived: a workshop and a cafe are
 * both busy places and a clinic is not, and the numbers say so.
 */
const INTERIOR_PROFILE_GAIN: Readonly<Record<InteriorAudioProfile, number>> = {
  home: 0.9,
  shop: 1.0,
  office: 0.75,
  clinic: 0.6,
  workshop: 1.0,
  cafe: 1.05,
  hangar: 0.55,
};

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private insectGain: GainNode | null = null;

  private started = false;
  private muted = false;
  private failed = false;

  private padVoices: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
  private chordIndex = 0;
  private motifStep = 0;
  private padTone: BiquadFilterNode | null = null;
  private padTarget = 1;
  private tracks: Partial<Record<'outdoor' | 'indoor', { el: HTMLAudioElement; gain: GainNode }>> = {};
  private zone: 'outdoor' | 'indoor' = 'outdoor';
  /** Multiplier on the indoor bed, set from the room's declared profile. */
  private interiorGain = 1;
  private tracksReady = false;
  private trackFailed = false;
  private nextChordAt = 0;
  private nextBirdAt = 0;
  private nextInsectAt = 0;
  private stepPhase = 0;
  private lastStepAt = -1;

  get available(): boolean {
    return this.started && !this.failed;
  }

  /** Call from a click/keypress. Safe to call repeatedly. */
  start(): void {
    if (this.started || this.failed) return;
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return;
      }
      const ctx = new Ctor();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.0001;
      this.master.connect(ctx.destination);

      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0.30;
      this.musicGain.connect(this.master);

      this.ambientGain = ctx.createGain();
      this.ambientGain.gain.value = 0.34;
      this.ambientGain.connect(this.master);

      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.value = 0.75;
      this.sfxGain.connect(this.master);

      this.buildWind();
      this.buildInsects();
      this.buildPad();
      this.buildTracks();

      this.started = true;
      // Fade in rather than punch in.
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, ctx.currentTime, 1.4);
      void ctx.resume();
      this.applyZone();
    } catch (err) {
      console.warn('[LastHorizon] audio unavailable', err);
      this.failed = true;
    }
  }

  private buildWind(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 4);
    src.loop = true;

    // Band-passed white noise high up: reads as air moving through leaves.
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.5;

    const gain = ctx.createGain();
    gain.gain.value = 0.045;

    src.connect(filter).connect(gain).connect(this.ambientGain!);
    src.start();

    this.windFilter = filter;
    this.windGain = gain;
  }

  private buildInsects(): void {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0.16;
    gain.connect(this.ambientGain!);
    this.insectGain = gain;
  }

  /**
   * Two looping tracks — one for outdoors, one for the interior — crossfaded
   * as the player moves between them.
   *
   * These are the only streamed assets in the project. If either fails to
   * load the synthesised pad below carries the scene on its own, so a missing
   * or blocked file degrades to "quieter", never to "broken".
   */
  private buildTracks(): void {
    const ctx = this.ctx!;
    for (const zone of ['outdoor', 'indoor'] as const) {
      const el = new Audio();
      el.src = `./assets/audio/${zone}.mp3`;
      el.loop = true;
      // The outdoor bed is wanted immediately. The indoor one is 1,103.7 kB
      // and is not audible until somebody walks through a door — so it waited
      // for one, from Phase 12 onward, instead of being downloaded by every
      // player who never goes inside.
      //
      // This is the same call the interior *kit* already makes, at the same
      // moment, and it lands in the same gap: entering a building fades to
      // black while 145 kB of GLB arrives, so the music rides along in a pause
      // the player is waiting through either way. Worth 1.1 MB off a first
      // visit, which is more than every code split in Phases 6 to 11 combined.
      el.preload = zone === 'outdoor' ? 'auto' : 'none';
      el.crossOrigin = 'anonymous';
      el.volume = 1;

      const gain = ctx.createGain();
      gain.gain.value = 0;
      try {
        // Scoped to the try: the routed node is never referenced afterwards,
        // and a failure here is already handled by falling back to the pad.
        const node = ctx.createMediaElementSource(el);
        node.connect(gain).connect(this.musicGain!);
      } catch (err) {
        console.warn(`[LastHorizon] could not route ${zone} track`, err);
      }

      el.addEventListener('error', () => {
        console.warn(`[LastHorizon] ${zone}.mp3 unavailable; staying with the synth bed`);
        this.trackFailed = true;
        this.padTarget = 1;
      });
      el.addEventListener('canplay', () => {
        this.tracksReady = true;
        this.applyZone();
      });

      this.tracks[zone] = { el, gain };
    }
  }

  /** Crossfade the two tracks and duck the synth pad when one is playing. */
  private applyZone(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const zone of ['outdoor', 'indoor'] as const) {
      const t = this.tracks[zone];
      if (!t) continue;
      const want = !this.trackFailed && this.tracksReady && this.zone === zone;
      const level = zone === 'indoor' ? 0.9 * this.interiorGain : 0.9;
      t.gain.gain.setTargetAtTime(want ? level : 0.0, now, 0.7);
      if (want && t.el.paused) {
        void t.el.play().catch(() => {
          /* blocked until a gesture; retried on the next zone change */
        });
      }
      if (!want && !t.el.paused) {
        // Let the fade finish before stopping, so it doesn't cut off.
        window.setTimeout(() => {
          if (this.zone !== zone) t.el.pause();
        }, 1600);
      }
    }
    // The synth pad steps aside for the real music, but stays as a bed.
    this.padTarget = this.trackFailed || !this.tracksReady ? 1 : 0.22;
  }

  /** Called by the game when the player moves between world and interior. */
  setZone(zone: 'outdoor' | 'indoor'): void {
    if (this.zone === zone) return;
    this.zone = zone;

    // First trip indoors: ask for the bed that was deliberately not preloaded.
    // `load()` is a no-op once the element has data, so this costs nothing on
    // every subsequent door.
    const track = this.tracks[zone];
    if (zone === 'indoor' && track && track.el.preload === 'none') {
      track.el.preload = 'auto';
      track.el.load();
    }

    this.applyZone();
  }

  /**
   * Shape the indoor bed for the kind of room you are in.
   *
   * There is **one** indoor loop, and Phase 7 introduced nine buildings. Rather
   * than ship seven more MP3s — 1.67 MB of audio is already most of the asset
   * budget — each interior declares a profile and that profile scales the bed.
   * A clinic sits quiet and a cafe sits forward, off the same file.
   *
   * This is deliberately modest. It is a level trim, not reverb; a hangar does
   * not sound like a hangar, it sounds like a quiet room. Recorded as such in
   * the Phase 7 report rather than described as room acoustics.
   */
  setInteriorProfile(profile: InteriorAudioProfile | null): void {
    const next = profile === null ? 1 : (INTERIOR_PROFILE_GAIN[profile] ?? 1);
    if (this.interiorGain === next) return;
    this.interiorGain = next;
    this.applyZone();
  }

  private buildPad(): void {
    const ctx = this.ctx!;

    // Shared warmth: one soft low-pass over the whole bed, the single most
    // "lo-fi" thing you can do to a synth pad.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1500;
    tone.Q.value = 0.4;
    tone.connect(this.musicGain!);
    this.padTone = tone;

    // Slow pitch drift, like a tape that isn't quite steady.
    const wobble = ctx.createOscillator();
    wobble.type = 'sine';
    wobble.frequency.value = 0.14;
    const wobbleAmount = ctx.createGain();
    wobbleAmount.gain.value = 5.5; // cents
    wobble.connect(wobbleAmount);
    wobble.start();

    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = CHORDS[0][i];
      osc.detune.value = (i - 1.5) * 4;
      wobbleAmount.connect(osc.detune);

      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(tone);
      osc.start();
      this.padVoices.push({ osc, gain });
    }

    // Vinyl surface noise: very quiet, heavily filtered, always there.
    const hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuffer(ctx, 3.5);
    hiss.loop = true;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 2600;
    hissFilter.Q.value = 0.7;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.014;
    hiss.connect(hissFilter).connect(hissGain).connect(this.musicGain!);
    hiss.start();
  }

  /** One soft bell note from the motif, played every few chord changes. */
  private bell(when: number, freq: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2.01;

    const g1 = ctx.createGain();
    g1.gain.setValueAtTime(0, when);
    g1.gain.linearRampToValueAtTime(0.075, when + 0.02);
    g1.gain.exponentialRampToValueAtTime(0.0004, when + 2.6);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0, when);
    g2.gain.linearRampToValueAtTime(0.022, when + 0.015);
    g2.gain.exponentialRampToValueAtTime(0.0004, when + 1.2);

    osc.connect(g1).connect(this.musicGain!);
    osc2.connect(g2).connect(this.musicGain!);
    osc.start(when);
    osc2.start(when);
    osc.stop(when + 2.8);
    osc2.stop(when + 1.4);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.25);
  }

  /** Pause the graph when the tab is hidden so it doesn't drone in the dark. */
  setSuspended(suspend: boolean): void {
    if (!this.ctx) return;
    if (suspend && this.ctx.state === 'running') void this.ctx.suspend();
    if (!suspend && this.ctx.state === 'suspended') void this.ctx.resume();
    for (const t of Object.values(this.tracks)) {
      if (!t) continue;
      if (suspend) t.el.pause();
    }
    if (!suspend) this.applyZone();
  }

  // ------------------------------------------------------------------ frame

  /**
   * @param speed          player ground speed, m/s
   * @param surface        1 = tarmac, 0 = grass
   * @param nightFactor    0 day, 1 night — swaps cicadas for crickets
   * @param moving         whether the player is on the ground and moving
   */
  update(
    dt: number,
    speed: number,
    surface: number,
    nightFactor: number,
    moving: boolean,
  ): void {
    if (!this.available || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // wind rises a little with speed, and thins out after dark
    if (this.windFilter && this.windGain) {
      const target = 1350 + speed * 60 + Math.sin(now * 0.13) * 340;
      this.windFilter.frequency.setTargetAtTime(target, now, 0.6);
      this.windGain.gain.setTargetAtTime(lerp(0.045, 0.032, nightFactor), now, 1.2);
    }


    // Chord rotation. Slow, but with an audible swell so it breathes rather
    // than drones — and the low-pass opens a touch on each new chord.
    if (now >= this.nextChordAt) {
      this.nextChordAt = now + 9.0;
      const chord = CHORDS[this.chordIndex % CHORDS.length];
      this.chordIndex++;
      this.padVoices.forEach((v, i) => {
        v.osc.frequency.setTargetAtTime(chord[i], now, 1.4);
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime((0.19 - i * 0.022) * this.padTarget, now, 1.8);
        v.gain.gain.setTargetAtTime(0.055 * this.padTarget, now + 5.5, 2.6);
      });
      if (this.padTone) {
        this.padTone.frequency.cancelScheduledValues(now);
        this.padTone.frequency.setTargetAtTime(2000, now, 1.5);
        this.padTone.frequency.setTargetAtTime(1350, now + 4.5, 2.5);
      }
      // A bell note on every other chord, tracing the motif.
      if (this.chordIndex % 2 === 1) {
        this.bell(now + 0.4, MOTIF[this.motifStep % MOTIF.length]);
        this.motifStep++;
      }
    }

    // birdsong by day, crickets by night
    if (now >= this.nextBirdAt) {
      this.nextBirdAt = now + 2.4 + Math.random() * 7.5;
      if (nightFactor < 0.45) this.chirp(now);
    }
    if (now >= this.nextInsectAt) {
      this.nextInsectAt = now + (nightFactor > 0.5 ? 0.42 : 1.5) + Math.random() * 0.9;
      this.insect(now, nightFactor);
    }

    this.updateFootsteps(dt, speed, surface, moving);
  }

  private updateFootsteps(dt: number, speed: number, surface: number, moving: boolean): void {
    if (!moving || speed < 0.35) {
      this.stepPhase = 0.62; // land the next step promptly when walking resumes
      return;
    }
    // Cadence rises with speed; roughly two steps per gait cycle.
    const cadence = clamp(speed * 0.92, 1.1, 3.4);
    this.stepPhase += dt * cadence;
    if (this.stepPhase >= 1) {
      this.stepPhase -= 1;
      const now = this.ctx!.currentTime;
      if (now - this.lastStepAt > 0.12) {
        this.footstep(now, surface, clamp(speed / 4, 0.35, 1));
        this.lastStepAt = now;
      }
    }
  }

  // ------------------------------------------------------------------- sfx

  private footstep(when: number, surface: Surface | number, force: number): void {
    const ctx = this.ctx!;
    const hard = typeof surface === 'number' ? surface : surface === 'road' ? 1 : 0;

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.12);

    const filter = ctx.createBiquadFilter();
    // Tarmac is a bright click; grass is a soft, low swish.
    filter.type = hard > 0.5 ? 'bandpass' : 'lowpass';
    filter.frequency.value = lerp(700, 2100, hard) * (0.85 + Math.random() * 0.3);
    filter.Q.value = lerp(0.7, 2.4, hard);

    const gain = ctx.createGain();
    const peak = lerp(0.085, 0.13, hard) * force;
    const decay = lerp(0.115, 0.055, hard);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0005, when + decay);

    src.connect(filter).connect(gain).connect(this.sfxGain!);
    src.start(when);
    src.stop(when + decay + 0.02);
  }

  private chirp(when: number): void {
    const ctx = this.ctx!;
    const notes = 2 + Math.floor(Math.random() * 3);
    const base = 2100 + Math.random() * 1500;
    for (let i = 0; i < notes; i++) {
      const t = when + i * (0.055 + Math.random() * 0.05);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f = base * (1 + (Math.random() - 0.4) * 0.28);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 1.35, t + 0.05);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.045, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);

      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;

      osc.connect(gain).connect(pan).connect(this.ambientGain!);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  private insect(when: number, nightFactor: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.09);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = nightFactor > 0.5 ? 4600 : 6800;
    filter.Q.value = 22;

    const gain = ctx.createGain();
    const peak = 0.05 + nightFactor * 0.05;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0005, when + 0.075);

    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.8 - 0.9;

    src.connect(filter).connect(gain).connect(pan).connect(this.insectGain!);
    src.start(when);
    src.stop(when + 0.1);
  }

  /** Bright arpeggio when a keepsake is found. */
  playDiscovery(): void {
    if (!this.available || !this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const notes = [659.25, 783.99, 987.77, 1318.51];
    notes.forEach((f, i) => {
      const t = t0 + i * 0.075;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0004, t + 0.85);
      osc.connect(gain).connect(this.sfxGain!);
      osc.start(t);
      osc.stop(t + 0.9);
    });
  }

  playJump(): void {
    if (!this.available || !this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.1);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.11);
    src.connect(filter).connect(gain).connect(this.sfxGain!);
    src.start(t);
    src.stop(t + 0.13);
  }

  playLand(force: number): void {
    if (!this.available || !this.ctx) return;
    this.footstep(this.ctx.currentTime, 0.6, clamp(force / 7, 0.5, 1.4));
  }

  dispose(): void {
    for (const v of this.padVoices) {
      try {
        v.osc.stop();
      } catch {
        /* already stopped */
      }
    }
    this.padVoices = [];
    for (const t of Object.values(this.tracks)) {
      if (!t) continue;
      t.el.pause();
      t.el.src = '';
    }
    this.tracks = {};
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
