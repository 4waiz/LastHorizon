/**
 * The three panels only Story Mode ever opens.
 *
 * These began life inside `HUD`, and the budget gate is why they are not there
 * any more: the app chunk went 351.1 kB to 365.2 kB against a 360 kB limit,
 * and the repository's rule is to move something rather than raise the ceiling.
 * `MapPanel` set the precedent in Phase 6 for exactly the same reason.
 *
 * The split is clean because the split is real. `HUD` is the chrome that is
 * always on — tiles, counter, wallet, prompt, objective line, captions. A
 * conversation, a journal and a Life Reel are things that happen in Story
 * Mode, behind an import the mode selector is already waiting on.
 *
 * Like the HUD, none of this knows what a quest stage is. It takes strings and
 * a callback, which is the brief's "no quest logic hidden in UI components"
 * made structural: `StoryDirector` decides, and this draws.
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

export interface ChoiceLine {
  readonly index: number;
  readonly text: string;
  readonly available: boolean;
  readonly lockedReason?: string;
}

export interface TurnLine {
  readonly speaker: string;
  readonly text: string;
  readonly choices: readonly ChoiceLine[];
}

export interface JournalEntry {
  readonly title: string;
  readonly stage: string;
  readonly objectives: readonly string[];
  readonly kind: string;
}

export class StoryPanels {
  private dialogue = $('dialogue');
  private dlgPortrait = $('dlgPortrait');
  private dlgSpeaker = $('dlgSpeaker');
  private dlgText = $('dlgText');
  private dlgChoices = $('dlgChoices');
  private dlgLog = $<HTMLOListElement>('dlgLog');
  private journal = $('journal');
  private journalBody = $('journalBody');
  private reel = $('reel');
  private reelCanvas = $<HTMLCanvasElement>('reelCanvas');

  /** True while any of the three is up, so the frame knows to release input. */
  get anyOpen(): boolean {
    return !this.dialogue.hidden || !this.journal.hidden || !this.reel.hidden;
  }

  get dialogueOpen(): boolean {
    return !this.dialogue.hidden;
  }

  get journalOpen(): boolean {
    return !this.journal.hidden;
  }

  get reelOpen(): boolean {
    return !this.reel.hidden;
  }

  /**
   * Draw one turn of a conversation.
   *
   * Choices are real `<button>`s, and unavailable ones are `disabled` rather
   * than removed. Two reasons, and both were decided rather than defaulted: a
   * locked option with its reason spelled out teaches what the relationship
   * axes are *for*, and removing one silently renumbers everything after it
   * for anybody navigating by position on a gamepad.
   */
  showDialogue(turn: TurnLine, speakerName: string, onChoose: (index: number) => void): void {
    this.dialogue.hidden = false;
    this.dlgLog.hidden = true;
    this.dlgSpeaker.textContent = speakerName;
    this.dlgPortrait.textContent = speakerName.slice(0, 1).toUpperCase();
    this.dlgText.textContent = turn.text;

    this.dlgChoices.replaceChildren();
    for (const c of turn.choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dlg__choice';
      btn.disabled = !c.available;
      btn.dataset.index = String(c.index);
      btn.textContent = c.text;
      if (!c.available && c.lockedReason) {
        const why = document.createElement('em');
        why.textContent = c.lockedReason;
        btn.appendChild(why);
      }
      if (c.available) btn.addEventListener('click', () => onChoose(c.index));
      this.dlgChoices.appendChild(btn);
    }

    // Land focus on something pressable, so keyboard and gamepad users do not
    // have to tab in from wherever focus happened to be.
    this.dlgChoices.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  setDialogueHistory(lines: readonly { speaker: string; text: string; reply?: string }[]): void {
    this.dlgLog.replaceChildren();
    for (const l of lines) {
      if (l.reply) {
        const li = document.createElement('li');
        li.textContent = `— ${l.reply}`;
        this.dlgLog.appendChild(li);
      }
      if (l.text) {
        const li = document.createElement('li');
        li.textContent = l.text;
        this.dlgLog.appendChild(li);
      }
    }
  }

  closeDialogue(): void {
    this.dialogue.hidden = true;
    this.dlgChoices.replaceChildren();
  }

  openJournal(open: boolean, entries: readonly JournalEntry[] = []): void {
    this.journal.hidden = !open;
    if (!open) return;

    this.journalBody.replaceChildren();
    if (entries.length === 0) {
      const p = document.createElement('p');
      p.className = 'journal__stage';
      p.textContent = 'Nothing on just now.';
      this.journalBody.appendChild(p);
      return;
    }

    for (const e of entries) {
      const card = document.createElement('div');
      card.className = `journal__quest${e.kind === 'side' ? ' journal__quest--side' : ''}`;

      const h = document.createElement('h3');
      h.textContent = e.title;
      const stage = document.createElement('p');
      stage.className = 'journal__stage';
      stage.textContent = e.stage;
      const list = document.createElement('ul');
      list.className = 'journal__objs';
      for (const o of e.objectives) {
        const li = document.createElement('li');
        li.textContent = o;
        list.appendChild(li);
      }

      card.append(h, stage, list);
      this.journalBody.appendChild(card);
    }
  }

  /**
   * Show the reel.
   *
   * `draw` is handed the context rather than an image, so the preview and the
   * exported PNG come from the same call. A preview that *can* disagree with
   * the export is a preview that eventually does.
   */
  openReel(open: boolean, draw?: (ctx: CanvasRenderingContext2D) => void): void {
    this.reel.hidden = !open;
    if (!open || !draw) return;
    const ctx = this.reelCanvas.getContext('2d');
    if (ctx) draw(ctx);
  }

  /** Wire the chrome buttons once. Returns a teardown for the disposal scope. */
  wire(handlers: { onLeaveDialogue: () => void; onSaveReel: () => void }): () => void {
    const toggleLog = () => {
      this.dlgLog.hidden = !this.dlgLog.hidden;
    };
    const closeJournal = () => this.openJournal(false);
    const closeReel = () => this.openReel(false);

    const bind = (id: string, fn: () => void): (() => void) => {
      const el = document.getElementById(id);
      el?.addEventListener('click', fn);
      return () => el?.removeEventListener('click', fn);
    };

    const offs = [
      bind('dlgSkip', handlers.onLeaveDialogue),
      bind('dlgHistory', toggleLog),
      bind('journalClose', closeJournal),
      bind('reelClose', closeReel),
      bind('reelSave', handlers.onSaveReel),
    ];
    return () => offs.forEach((off) => off());
  }
}
