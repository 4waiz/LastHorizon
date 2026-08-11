import './CreditsPanel.css';

/**
 * The credits, as a screen.
 *
 * They were a section at the bottom of the settings modal, below audio,
 * graphics, time, needs, action, accessibility and the controls reference.
 * The phase brief lists credits as a *screen*, and it is right to: credits
 * you reach by scrolling past six settings groups are credits nobody reads,
 * and this game has attribution it should be easy to find — the studio, the
 * developer, the honest asset statement, and every third-party licence
 * actually used.
 *
 * **This class does almost nothing on purpose.** The credits are static
 * markup in `index.html` with no state to sync and no controls to wire. What
 * it exists for is the `import './CreditsPanel.css'` above: that is what makes
 * the ~5 kB of credits styling a lazy sibling chunk rather than part of the
 * eager stylesheet, on the same rule every other panel follows.
 *
 * Those rules previously lived in `SettingsPanel.css` because the markup did.
 * They moved with it — a stylesheet left behind when its markup leaves is the
 * `.dash` bug from earlier in this phase, where the vehicle dashboard's rules
 * stayed in a lazy chunk it no longer had anything to do with.
 */
export class CreditsPanel {
  /**
   * Called by `LazyPanel` on open.
   *
   * Nothing to refresh: the credits are the same every time, which is what
   * makes them credits. Present so the panel matches the shape of every other
   * one rather than being the odd case a future edit has to remember.
   */
  open(): void {
    /* intentionally empty */
  }
}
