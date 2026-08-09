import { t } from './strings';
import { endingById } from './Endings';
import type { StoryState } from './StoryState';
import type { Reputation } from './QuestDefinition';

/**
 * What did you become by 25?
 *
 * The reel is two things: a **model**, which is pure and testable and is what
 * every assertion in `lifeReel.test.ts` reads, and a **renderer**, which draws
 * that model onto a canvas. Keeping them apart is what lets "the reel reflects
 * the choices" be a unit test rather than a screenshot somebody eyeballs.
 *
 * Three rules, all from the brief and all enforced below:
 *
 * 1. **Deterministic.** No `Date.now()`, no `Math.random()`, no locale-dependent
 *    formatting. The same save produces byte-identical pixels, which is the
 *    only way a visual regression test on this is worth running.
 * 2. **Privacy-safe.** Nothing personal reaches the card. No timestamps, no
 *    device information, no save path, no player-typed text that has not been
 *    through `sanitiseName`. What is on it is what happened in the fiction.
 * 3. **Local.** `toBlob` and an object URL. There is no upload endpoint in
 *    this repository and this phase does not add one.
 */

export interface ReelFacts {
  readonly age: number;
  readonly money: number;
  readonly shiftsWorked: number;
  readonly vehiclesOwned: number;
  readonly keepsakes: number;
  readonly keepsakeTotal: number;
  /** Interior ids the player holds. */
  readonly property: readonly string[];
  /** Residents who would answer, with a display name already resolved. */
  readonly friends: readonly { readonly name: string; readonly closeness: number }[];
  readonly reputation: Reputation;
  /** Optional, and sanitised before it is drawn. */
  readonly playerName?: string;
}

export interface ReelRow {
  readonly label: string;
  readonly value: string;
}

export interface ReelSection {
  readonly title: string;
  readonly rows: readonly ReelRow[];
}

export interface ReelModel {
  readonly title: string;
  readonly subtitle: string;
  readonly name: string;
  readonly timeline: readonly { readonly age: number; readonly text: string; readonly kind: string }[];
  readonly sections: readonly ReelSection[];
  readonly finalTitle: string;
  readonly finalBody: string;
}

/**
 * Strip a player-supplied name down to something safe to draw.
 *
 * The canvas cannot execute anything, so this is not an XSS guard — it is a
 * *layout and privacy* guard. Twenty characters of letters, spaces, hyphens
 * and apostrophes: enough for a name, not enough to paste an address into.
 */
export function sanitiseName(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/[^\p{L}\p{M} '-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}

/** Whole dollars, grouped, with no locale dependence. */
function money(n: number): string {
  const s = Math.max(0, Math.floor(n)).toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return `$${out}`;
}

function recordLabel(law: number): string {
  if (law >= 0.9) return t('reel.record.clean');
  if (law >= 0.45) return t('reel.record.marked');
  return t('reel.record.bad');
}

function standingLabel(community: number): string {
  const pips = Math.max(0, Math.min(5, Math.round(community * 5)));
  return '●'.repeat(pips) + '○'.repeat(5 - pips);
}

/**
 * Build the model.
 *
 * The timeline is the reel's spine and it is **sorted by age, stably**. Events
 * are recorded in the order they happen, so a stable sort keeps two things
 * that happened in the same year in the order the player did them — which is
 * the difference between "bought a bicycle, then rode it" and the reverse.
 */
export function buildReel(state: StoryState, facts: ReelFacts): ReelModel {
  const timeline = [...state.reel]
    .map((e, index) => ({ e, index }))
    .sort((a, b) => a.e.age - b.e.age || a.index - b.index)
    .map(({ e }) => ({
      age: e.age,
      kind: e.kind,
      text: e.detail ? `${t(e.textKey)} — ${e.detail}` : t(e.textKey),
    }));

  const choices = timeline.filter((r) => r.kind === 'choice' || r.kind === 'chapter');
  const friends = [...facts.friends]
    .sort((a, b) => b.closeness - a.closeness || (a.name < b.name ? -1 : 1))
    .slice(0, 5);

  const ending = state.endingId ? endingById(state.endingId) : null;

  return {
    title: t('reel.title'),
    subtitle: t('reel.subtitle'),
    name: sanitiseName(facts.playerName),
    timeline,
    sections: [
      {
        title: t('reel.section.choices'),
        rows: choices.length
          ? choices.map((c) => ({ label: `${c.age.toFixed(0)}`, value: c.text }))
          : [{ label: '', value: t('reel.empty') }],
      },
      {
        title: t('reel.section.work'),
        rows: [
          { label: t('reel.stat.money'), value: money(facts.money) },
          { label: t('reel.stat.jobs'), value: String(facts.shiftsWorked) },
          { label: t('reel.stat.vehicles'), value: String(facts.vehiclesOwned) },
        ],
      },
      {
        title: t('reel.section.people'),
        rows: friends.length
          ? friends.map((f) => ({ label: f.name, value: closenessLabel(f.closeness) }))
          : [{ label: '', value: t('reel.empty') }],
      },
      {
        title: t('reel.section.record'),
        rows: [
          { label: t('reel.section.record'), value: recordLabel(facts.reputation.law) },
          { label: t('reel.stat.community'), value: standingLabel(facts.reputation.community) },
        ],
      },
      {
        title: t('reel.section.things'),
        rows: [
          {
            label: t('reel.stat.keepsakes'),
            value: `${facts.keepsakes} / ${facts.keepsakeTotal}`,
          },
          ...facts.property.map((p) => ({ label: p, value: '✓' })),
        ],
      },
    ],
    finalTitle: ending ? t(ending.titleKey) : t('reel.subtitle'),
    finalBody: ending ? t(ending.bodyKey) : t('reel.empty'),
  };
}

function closenessLabel(v: number): string {
  const pips = Math.max(1, Math.min(5, Math.round(v * 5)));
  return '●'.repeat(pips);
}

/** A single birthday card. Small, warm, and gone in four seconds. */
export interface Postcard {
  readonly age: number;
  readonly title: string;
  readonly body: string;
}

export function postcardFor(age: number, unlocked: readonly string[]): Postcard {
  return {
    age,
    title: t('reel.birthday', { age }),
    body: unlocked.length > 0 ? unlocked.join(' · ') : t('reel.empty'),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** The coastal palette, taken from the title screen's own gradients. */
const PAPER = '#f4efe2';
const INK = '#33413c';
const MUTED = '#6f8078';
const RULE = '#cdd8c8';
const ACCENT = '#639a4e';
const SUN = '#eab866';

export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1350;

/**
 * Draw the card.
 *
 * A 4:5 portrait, which is the shape that survives being looked at on a phone.
 * Everything is laid out from measured text rather than from magic offsets, so
 * a longer ending body pushes what follows instead of overlapping it.
 *
 * Fonts come from the system stack the rest of the UI uses. That does mean the
 * pixels differ between machines — so the *visual* test asserts layout
 * anchors and the model, not a pixel hash, and `docs/TEST_STRATEGY.md` says so.
 */
export function renderReel(ctx: CanvasRenderingContext2D, model: ReelModel): void {
  const W = REEL_WIDTH;
  const H = REEL_HEIGHT;
  const M = 72;

  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // A soft horizon band, so the card is recognisably this game.
  const sky = ctx.createLinearGradient(0, 0, 0, 260);
  sky.addColorStop(0, '#cfe3ee');
  sky.addColorStop(1, PAPER);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, 260);
  ctx.fillStyle = SUN;
  ctx.beginPath();
  ctx.arc(W - 150, 120, 46, 0, Math.PI * 2);
  ctx.fill();

  let y = M + 40;

  ctx.fillStyle = INK;
  ctx.font = '600 58px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(model.title, M, y);
  y += 46;

  ctx.fillStyle = MUTED;
  ctx.font = '400 30px system-ui, sans-serif';
  ctx.fillText(model.subtitle, M, y);
  y += 34;

  if (model.name) {
    ctx.fillStyle = ACCENT;
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.fillText(model.name, M, y);
    y += 34;
  }

  y += 18;
  y = rule(ctx, M, y, W - M);

  // -- the ending, first: it is the answer to the question on the card ------
  ctx.fillStyle = INK;
  ctx.font = '600 40px system-ui, sans-serif';
  y = wrap(ctx, model.finalTitle, M, y + 44, W - M * 2, 46);

  ctx.fillStyle = MUTED;
  ctx.font = '400 26px system-ui, sans-serif';
  y = wrap(ctx, model.finalBody, M, y + 30, W - M * 2, 36);

  y = rule(ctx, M, y + 26, W - M);

  // -- sections in two columns ----------------------------------------------
  const colW = (W - M * 2 - 48) / 2;
  let leftY = y + 44;
  let rightY = y + 44;

  model.sections.forEach((section, i) => {
    const left = i % 2 === 0;
    const x = left ? M : M + colW + 48;
    let sy = left ? leftY : rightY;

    ctx.fillStyle = ACCENT;
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillText(section.title.toUpperCase(), x, sy);
    sy += 30;

    ctx.font = '400 23px system-ui, sans-serif';
    for (const row of section.rows.slice(0, 8)) {
      ctx.fillStyle = MUTED;
      if (row.label) ctx.fillText(row.label, x, sy);
      ctx.fillStyle = INK;
      const valueX = row.label ? x + 132 : x;
      sy = wrap(ctx, row.value, valueX, sy, colW - (row.label ? 132 : 0), 30);
      sy += 6;
    }
    sy += 26;

    if (left) leftY = sy;
    else rightY = sy;
  });

  // -- footer ----------------------------------------------------------------
  ctx.fillStyle = MUTED;
  ctx.font = '400 20px system-ui, sans-serif';
  ctx.fillText('Last Horizon — A Kanban Studios game', M, H - M);
  ctx.restore();
}

function rule(ctx: CanvasRenderingContext2D, x: number, y: number, x2: number): number {
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  return y;
}

/** Word wrap on measured text. Returns the baseline after the last line. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(' ');
  let line = '';
  let cursor = y;

  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (ctx.measureText(attempt).width > maxWidth && line) {
      ctx.fillText(line, x, cursor);
      cursor += lineHeight;
      line = word;
    } else {
      line = attempt;
    }
  }
  if (line) {
    ctx.fillText(line, x, cursor);
    cursor += lineHeight;
  }
  return cursor - lineHeight;
}

/**
 * Render to a PNG blob, locally.
 *
 * Returns null rather than throwing when a 2D context is unavailable — a
 * browser that refuses one is a browser where the reel simply is not
 * exportable, and that is a degradation rather than a crash.
 */
export async function exportReel(
  model: ReelModel,
  makeCanvas: () => HTMLCanvasElement,
): Promise<Blob | null> {
  const canvas = makeCanvas();
  canvas.width = REEL_WIDTH;
  canvas.height = REEL_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  renderReel(ctx, model);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

/**
 * Hand the file to the player.
 *
 * An object URL and a synthetic click: no network, no service, nothing leaves
 * the device. The URL is revoked immediately — the browser has already taken
 * its copy by the time the click returns.
 */
export function downloadReel(blob: Blob, filename = 'last-horizon-life-reel.png'): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.click();
  URL.revokeObjectURL(url);
}
