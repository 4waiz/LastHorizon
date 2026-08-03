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

export interface SettingsState {
  quality: QualityLevel;
  muted: boolean;
  timeMode: TimeMode;
}

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
