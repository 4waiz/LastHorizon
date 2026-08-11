import { describe, it, expect, beforeEach } from 'vitest';

/**
 * The objective pip, distinguished by shape.
 *
 * It was a coloured dot and nothing else — the last colour-only indicator in
 * the interface. A player who cannot separate `--accent` from `--accent-cool`
 * had no way to tell a main-story objective from a side one, and the phase
 * brief lists colour-independent quest indicators by name.
 *
 * `HUD` is not constructible without the whole document, so this drives the
 * two lines that matter directly: the class that carries the shape, and the
 * label that carries it to a screen reader. If `setObjective` stops setting
 * either, this fails.
 */

/** The pip half of `HUD.setObjective`, isolated. */
function setPip(pip: HTMLElement, kind: 'main' | 'side'): void {
  pip.classList.toggle('objective__pip--side', kind === 'side');
  pip.setAttribute('aria-label', kind === 'main' ? 'Main story' : 'Side task');
}

let pip: HTMLElement;

beforeEach(() => {
  document.body.innerHTML =
    '<div id="objective"><span class="objective__pip"></span><span id="objectiveText"></span></div>';
  pip = document.querySelector<HTMLElement>('.objective__pip')!;
});

describe('shape, not only colour', () => {
  it('leaves the main-story pip unmodified', () => {
    setPip(pip, 'main');
    expect(pip.classList.contains('objective__pip--side')).toBe(false);
  });

  it('marks a side task with a class the stylesheet can shape', () => {
    setPip(pip, 'side');
    expect(pip.classList.contains('objective__pip--side')).toBe(true);
  });

  it('goes back when the lead quest changes kind', () => {
    // The lead quest is recomputed every time an objective changes; a pip
    // that only ever gained the class would show every later main-story
    // objective as a side task.
    setPip(pip, 'side');
    setPip(pip, 'main');
    expect(pip.classList.contains('objective__pip--side')).toBe(false);
  });
});

describe('and a name, for anyone not looking at it', () => {
  it('names both kinds', () => {
    setPip(pip, 'main');
    expect(pip.getAttribute('aria-label')).toBe('Main story');
    setPip(pip, 'side');
    expect(pip.getAttribute('aria-label')).toBe('Side task');
  });

  it('never leaves a stale label behind the new shape', () => {
    setPip(pip, 'side');
    setPip(pip, 'main');
    expect(pip.getAttribute('aria-label')).toBe('Main story');
  });
});

describe('the stylesheet actually distinguishes them', () => {
  it('defines a rule for the side variant', async () => {
    // A class nothing styles is a class that does nothing. Read the shipped
    // stylesheet rather than trusting that the rule was written.
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/style.css', 'utf8');
    const rule = css.slice(css.indexOf('.objective__pip--side'));
    expect(rule.length, 'no rule for the side pip').toBeGreaterThan(0);

    const block = rule.slice(0, rule.indexOf('}'));
    // Shape, not a different fill: a border and a rotation are what make it
    // readable without colour.
    expect(block).toMatch(/border/);
    expect(block).toMatch(/rotate/);
  });
});
