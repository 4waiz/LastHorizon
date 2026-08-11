/** Quality presets, device detection and persisted user preferences. */

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  readonly label: string;
  /** Hard cap on devicePixelRatio. */
  readonly pixelRatio: number;
  readonly shadowMapSize: number;
  /** Half-extent of the sun's orthographic shadow box, in metres. */
  readonly shadowRadius: number;
  readonly shadowsEnabled: boolean;
  readonly vegetationDensity: number;
  readonly grassDensity: number;
  readonly grassRadius: number;
  readonly cloudCount: number;
  readonly birdCount: number;
  readonly antialias: boolean;
  readonly fogFar: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'Low',
    pixelRatio: 1.0,
    shadowMapSize: 1024,
    shadowRadius: 42,
    shadowsEnabled: true,
    vegetationDensity: 0.45,
    grassDensity: 0.0,
    grassRadius: 0,
    cloudCount: 9,
    birdCount: 10,
    antialias: false,
    fogFar: 330,
  },
  medium: {
    label: 'Medium',
    pixelRatio: 1.5,
    shadowMapSize: 2048,
    shadowRadius: 58,
    shadowsEnabled: true,
    vegetationDensity: 0.75,
    grassDensity: 0.5,
    grassRadius: 34,
    cloudCount: 14,
    birdCount: 18,
    antialias: true,
    fogFar: 440,
  },
  high: {
    label: 'High',
    pixelRatio: 2.0,
    shadowMapSize: 4096,
    shadowRadius: 72,
    shadowsEnabled: true,
    vegetationDensity: 1.0,
    grassDensity: 1.0,
    grassRadius: 48,
    cloudCount: 20,
    birdCount: 28,
    antialias: true,
    fogFar: 560,
  },
};

export const QUALITY_ORDER: readonly QualityLevel[] = ['low', 'medium', 'high'];

export interface DeviceInfo {
  readonly touch: boolean;
  readonly cores: number;
  readonly memoryGb: number;
  readonly maxDimension: number;
}

export function readDevice(): DeviceInfo {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const win = typeof window === 'undefined' ? undefined : window;
  const touch = !!nav && (nav.maxTouchPoints > 0 || 'ontouchstart' in (win ?? {}));
  return {
    touch,
    cores: nav?.hardwareConcurrency ?? 4,
    memoryGb: (nav as unknown as { deviceMemory?: number })?.deviceMemory ?? 4,
    maxDimension: win ? Math.max(win.screen?.width ?? 1280, win.screen?.height ?? 720) : 1280,
  };
}

/**
 * Pick a starting preset. Deliberately conservative: it is far better to
 * open at Medium and let someone raise it than to open at High and stutter.
 */
export function detectQuality(d: DeviceInfo = readDevice()): QualityLevel {
  if (d.touch) {
    return d.cores >= 8 && d.memoryGb >= 4 ? 'medium' : 'low';
  }
  if (d.cores <= 4 || d.memoryGb <= 4) return 'medium';
  if (d.cores >= 8 && d.memoryGb >= 8 && d.maxDimension >= 1440) return 'high';
  return 'medium';
}

export type TimeMode = 'cycle' | 'day' | 'dusk' | 'night';

/** Mirrors `NeedId` in src/player/Needs.ts, which must not be imported here:
 *  Settings is loaded before the player exists and has no other dependency
 *  on gameplay code. `settings.test.ts` keeps the two in step. */
export type NeedId = 'hunger' | 'energy' | 'cleanliness' | 'mood';
export const NEED_IDS: readonly NeedId[] = ['hunger', 'energy', 'cleanliness', 'mood'];

export interface SettingsState {
  quality: QualityLevel;
  muted: boolean;
  timeMode: TimeMode;
  /**
   * Soft-need accessibility. Off means a need neither decays nor penalises;
   * `needsDecay` scales how fast the enabled ones drain, 0 freezing them.
   *
   * These are accessibility options, not difficulty: someone who finds a drain
   * bar stressful should be able to switch it off and still play the game.
   */
  needsEnabled: Record<NeedId, boolean>;
  needsDecay: number;

  /**
   * Combat accessibility, added in Phase 9.
   *
   * All four default to the *least* assistance and the most restraint, which
   * is the right default for options that change how a game plays: a player
   * who wants aim assist will find it, and a player who never opens settings
   * gets the game as designed. `flashes` is the exception and defaults on,
   * because turning effects off by default would look like a bug.
   *
   * `combatDifficulty` scales incoming composure loss. It is deliberately the
   * only one of the four that touches the simulation rather than the
   * presentation.
   */
  aimAssist: number;
  cameraShake: number;
  flashes: boolean;
  combatDifficulty: number;

  /**
   * Presentation accessibility, added in Phase 11.
   *
   * These four differ from the combat options above in one important way:
   * they default to *the game as designed* rather than to the least
   * assistance, because none of them changes how the game plays. Scaling the
   * text or turning off motion costs a player nothing and is nobody's
   * difficulty setting.
   *
   * `reducedMotion` is deliberately tri-state. `auto` follows the operating
   * system, which is what most players want and what the CSS media query
   * already does; `on` and `off` are for the player whose OS setting does not
   * match what they want from a game specifically.
   */
  uiScale: number;
  reducedMotion: 'auto' | 'on' | 'off';
  highContrast: boolean;
  /** Draw the Heat level as a numeral as well as pips, for colour blindness. */
  heatNumerals: boolean;
  /** Flying, exposed here because Phase 10 shipped it with no interface. */
  flightAssist: 'assisted' | 'reduced';

  /**
   * Per-bus levels, 0..1, multiplied onto the mix `AudioManager` designs.
   *
   * Deliberately multipliers rather than absolute gains. The balance between
   * a music bed at 0.30 and effects at 0.75 is a mix decision that belongs in
   * the audio code; what belongs to the player is *more music, less wind*.
   * Handing them raw gain values would make every preset a different game.
   *
   * `muted` stays separate and still wins. It is one keypress from the HUD
   * and has to work without disturbing whatever the sliders were set to.
   */
  volumes: Record<AudioBus, number>;
}

/**
 * The four buses.
 *
 * `ui` is separate from `sfx` on purpose: interface clicks are the sound
 * players turn off first, and folding them into world effects would mean
 * silencing footsteps to silence a button.
 */
export type AudioBus = 'master' | 'music' | 'ambience' | 'sfx' | 'ui';

export const AUDIO_BUSES: readonly AudioBus[] = ['master', 'music', 'ambience', 'sfx', 'ui'];

export const DEFAULT_VOLUMES: Record<AudioBus, number> = {
  master: 1,
  music: 1,
  ambience: 1,
  sfx: 1,
  ui: 1,
};

const STORAGE_KEY = 'lasthorizon.settings.v1';

type Listener = (s: Readonly<SettingsState>) => void;

/** Reactive, persisted settings. Storage is injectable so tests stay pure. */
export class Settings {
  private state: SettingsState;
  private listeners = new Set<Listener>();

  constructor(
    private storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage,
    defaults?: Partial<SettingsState>,
  ) {
    this.state = {
      quality: detectQuality(),
      muted: false,
      timeMode: 'cycle',
      needsEnabled: { hunger: true, energy: true, cleanliness: true, mood: true },
      needsDecay: 1,
      aimAssist: 0,
      cameraShake: 1,
      flashes: true,
      combatDifficulty: 1,
      uiScale: 1,
      reducedMotion: 'auto',
      highContrast: false,
      heatNumerals: false,
      flightAssist: 'assisted',
      volumes: { ...DEFAULT_VOLUMES },
      ...defaults,
      ...this.read(),
    };
  }

  private read(): Partial<SettingsState> {
    if (!this.storage) return {};
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Partial<SettingsState>;
      const out: Partial<SettingsState> = {};
      if (parsed.quality && QUALITY_ORDER.includes(parsed.quality)) out.quality = parsed.quality;
      if (typeof parsed.muted === 'boolean') out.muted = parsed.muted;
      if (parsed.timeMode && ['cycle', 'day', 'dusk', 'night'].includes(parsed.timeMode)) {
        out.timeMode = parsed.timeMode;
      }
      if (parsed.needsEnabled && typeof parsed.needsEnabled === 'object') {
        // Per key, so a stored blob missing one -- or carrying a need that no
        // longer exists -- cannot switch the others off or add a phantom.
        const e: Record<NeedId, boolean> = {
          hunger: true, energy: true, cleanliness: true, mood: true,
        };
        for (const id of NEED_IDS) {
          const v = parsed.needsEnabled[id];
          if (typeof v === 'boolean') e[id] = v;
        }
        out.needsEnabled = e;
      }
      if (typeof parsed.needsDecay === 'number' && Number.isFinite(parsed.needsDecay)) {
        out.needsDecay = Math.min(2, Math.max(0, parsed.needsDecay));
      }

      // Combat accessibility, clamped on the way in for the same reason
      // `needsDecay` is: storage is the least trustworthy input this class
      // takes, and an aim assist of 40 would be a cheat rather than a setting.
      const num = (v: unknown, lo: number, hi: number): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;

      const assist = num(parsed.aimAssist, 0, 1);
      if (assist !== null) out.aimAssist = assist;
      const shake = num(parsed.cameraShake, 0, 1);
      if (shake !== null) out.cameraShake = shake;
      const difficulty = num(parsed.combatDifficulty, 0.25, 2);
      if (difficulty !== null) out.combatDifficulty = difficulty;
      if (typeof parsed.flashes === 'boolean') out.flashes = parsed.flashes;

      // Phase 11. Same defensive read: storage is untrusted, and a bad
      // `uiScale` is a interface nobody can read their way out of.
      const scale = num(parsed.uiScale, 0.85, 1.6);
      if (scale !== null) out.uiScale = scale;
      if (parsed.reducedMotion === 'auto' || parsed.reducedMotion === 'on' ||
          parsed.reducedMotion === 'off') {
        out.reducedMotion = parsed.reducedMotion;
      }
      if (typeof parsed.highContrast === 'boolean') out.highContrast = parsed.highContrast;
      if (typeof parsed.heatNumerals === 'boolean') out.heatNumerals = parsed.heatNumerals;
      if (parsed.flightAssist === 'assisted' || parsed.flightAssist === 'reduced') {
        out.flightAssist = parsed.flightAssist;
      }

      // Per bus, and clamped, for the same reason `needsEnabled` is read per
      // key: a stored blob missing one bus, or carrying a bus that no longer
      // exists, must not silence the others or add a phantom.
      if (parsed.volumes && typeof parsed.volumes === 'object') {
        const v: Record<AudioBus, number> = { ...DEFAULT_VOLUMES };
        for (const bus of AUDIO_BUSES) {
          const level = num(parsed.volumes[bus], 0, 1);
          if (level !== null) v[bus] = level;
        }
        out.volumes = v;
      }

      return out;
    } catch {
      return {};
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* private browsing / quota — settings simply don't survive the session */
    }
  }

  get current(): Readonly<SettingsState> {
    return this.state;
  }

  get preset(): QualityPreset {
    return QUALITY_PRESETS[this.state.quality];
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.persist();
    for (const fn of this.listeners) fn(this.state);
  }

  setQuality(q: QualityLevel): void {
    if (this.state.quality === q) return;
    this.state.quality = q;
    this.emit();
  }

  cycleQuality(): QualityLevel {
    const i = QUALITY_ORDER.indexOf(this.state.quality);
    const next = QUALITY_ORDER[(i + 1) % QUALITY_ORDER.length];
    this.setQuality(next);
    return next;
  }

  setMuted(m: boolean): void {
    if (this.state.muted === m) return;
    this.state.muted = m;
    this.emit();
  }

  toggleMuted(): boolean {
    this.setMuted(!this.state.muted);
    return this.state.muted;
  }

  setNeedEnabled(id: NeedId, on: boolean): void {
    if (this.state.needsEnabled[id] === on) return;
    this.state.needsEnabled = { ...this.state.needsEnabled, [id]: on };
    this.emit();
  }

  /** 0 freezes every need; 1 is normal. Clamped to 0..2. */
  setNeedsDecay(scale: number): void {
    if (!Number.isFinite(scale)) return;
    const v = Math.min(2, Math.max(0, scale));
    if (this.state.needsDecay === v) return;
    this.state.needsDecay = v;
    this.emit();
  }

  /**
   * The four combat options, in one setter.
   *
   * One method rather than four because they are set together — from a
   * settings panel, and from the test bridge — and because each is clamped on
   * the way in, which is the only behaviour worth having four copies of.
   */
  setCombatOption(key: 'aimAssist' | 'cameraShake' | 'flashes' | 'combatDifficulty', value: number | boolean): void {
    if (key === 'flashes') {
      if (typeof value !== 'boolean' || this.state.flashes === value) return;
      this.state.flashes = value;
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      const [lo, hi] = key === 'combatDifficulty' ? [0.25, 2] : [0, 1];
      const next = Math.min(hi, Math.max(lo, value));
      if (this.state[key] === next) return;
      this.state[key] = next;
    }
    this.persist();
    this.emit();
  }

  /**
   * The five presentation options, in one setter, for the same reason as
   * above: they are set from one panel and each is validated on the way in.
   *
   * Every branch checks the *type* before the value. This is reached from the
   * settings panel and from the test bridge, and the bridge is as untrusted as
   * storage — Phase 9's combat options learned that when a clamped value
   * arrived as a string.
   */
  /**
   * Set one bus level, 0..1.
   *
   * Ignores an unknown bus and a value that is not a finite number rather
   * than throwing, matching every other setter here: settings arrive from
   * storage and from a DOM slider, and neither is a trusted caller.
   */
  setVolume(bus: AudioBus, level: number): void {
    if (!AUDIO_BUSES.includes(bus)) return;
    if (typeof level !== 'number' || !Number.isFinite(level)) return;
    const next = Math.min(1, Math.max(0, level));
    if (this.state.volumes[bus] === next) return;
    this.state.volumes = { ...this.state.volumes, [bus]: next };
    this.persist();
    this.emit();
  }

  setAccessOption(
    key: 'uiScale' | 'reducedMotion' | 'highContrast' | 'heatNumerals' | 'flightAssist',
    value: number | boolean | string,
  ): void {
    switch (key) {
      case 'uiScale': {
        if (typeof value !== 'number' || !Number.isFinite(value)) return;
        // 0.85 to 1.6: below that the HUD stops being legible on a phone,
        // above it the panels stop fitting one.
        const next = Math.min(1.6, Math.max(0.85, value));
        if (this.state.uiScale === next) return;
        this.state.uiScale = next;
        break;
      }
      case 'reducedMotion': {
        if (value !== 'auto' && value !== 'on' && value !== 'off') return;
        if (this.state.reducedMotion === value) return;
        this.state.reducedMotion = value;
        break;
      }
      case 'flightAssist': {
        if (value !== 'assisted' && value !== 'reduced') return;
        if (this.state.flightAssist === value) return;
        this.state.flightAssist = value;
        break;
      }
      default: {
        if (typeof value !== 'boolean' || this.state[key] === value) return;
        this.state[key] = value;
        break;
      }
    }
    this.persist();
    this.emit();
  }

  setTimeMode(m: TimeMode): void {
    if (this.state.timeMode === m) return;
    this.state.timeMode = m;
    this.emit();
  }

  cycleTimeMode(): TimeMode {
    const order: TimeMode[] = ['cycle', 'day', 'dusk', 'night'];
    const next = order[(order.indexOf(this.state.timeMode) + 1) % order.length];
    this.setTimeMode(next);
    return next;
  }
}
