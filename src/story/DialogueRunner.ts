import { availableChoices, type DialogueContext } from '../npc/Dialogue';
import { t } from './strings';
import type { StoryDialogueChoice, StoryDialogueNode, StoryDialogueTree } from './dialogueCatalog';
import type { Consequence } from './QuestDefinition';

/**
 * One conversation, in progress.
 *
 * The runner owns *where you are in the tree* and nothing else. It does not
 * touch relationships, does not apply consequences, and does not draw
 * anything: it returns what should happen and the host does it. That is the
 * same shape `StoryClock.advance` uses — expired timers are returned, not
 * fired — and for the same reason, which is that the caller has to control
 * ordering against the save.
 *
 * **History is kept because the brief asks for it, and because of touch.** A
 * line that has scrolled past on a phone is a line the player cannot get back,
 * and a story whose stakes are set in one sentence three nodes ago needs a way
 * to re-read that sentence.
 */

export interface DialogueLine {
  readonly speaker: string;
  /** Already resolved through `t()`. The panel renders it directly. */
  readonly text: string;
  /** What the player said to get here, if anything. */
  readonly reply?: string;
}

export interface ChoiceView {
  readonly index: number;
  readonly text: string;
  readonly available: boolean;
  /** Present when unavailable and the choice is not hidden. */
  readonly lockedReason?: string;
}

export interface DialogueTurn {
  readonly treeId: string;
  readonly nodeId: string;
  readonly speaker: string;
  readonly text: string;
  readonly choices: readonly ChoiceView[];
}

/** What picking a choice produced. Applied by the host, never here. */
export interface ChoiceOutcome {
  readonly consequences: readonly Consequence[];
  readonly relationship: StoryDialogueChoice['effects'];
  readonly offersTask?: string;
  readonly ended: boolean;
}

export class DialogueRunner {
  private tree: StoryDialogueTree | null = null;
  private node: StoryDialogueNode | null = null;
  private ctx: DialogueContext = { relationship: NEUTRAL_AXES, playerAge: 15 };
  private readonly log: DialogueLine[] = [];
  /** The resident this conversation is with, for the portrait and effects. */
  private partner = '';

  get active(): boolean {
    return this.tree !== null;
  }

  get treeId(): string | null {
    return this.tree?.id ?? null;
  }

  get npcId(): string {
    return this.partner;
  }

  get history(): readonly DialogueLine[] {
    return this.log;
  }

  /**
   * Open a tree.
   *
   * `ctx` is captured rather than read live, so a relationship nudged by an
   * effect halfway through cannot retroactively unlock a choice the player was
   * already looking at — which would be a button appearing under the cursor.
   */
  start(tree: StoryDialogueTree, npcId: string, ctx: DialogueContext): DialogueTurn | null {
    const root = tree.nodes[tree.root];
    if (!root) return null;

    this.tree = tree;
    this.partner = npcId;
    this.ctx = ctx;
    this.log.length = 0;
    return this.enter(root);
  }

  private enter(node: StoryDialogueNode, reply?: string): DialogueTurn {
    this.node = node;
    const text = t(node.text, { name: this.partner });
    this.log.push({ speaker: node.speaker ?? this.partner, text, reply });
    return this.turn();
  }

  private turn(): DialogueTurn {
    const node = this.node!;
    const allowed = new Set(availableChoices(node, this.ctx));

    const choices: ChoiceView[] = [];
    node.choices.forEach((c, index) => {
      const available = allowed.has(c);
      if (!available && c.hideWhenUnavailable) return;
      choices.push({
        index,
        text: t(c.text),
        available,
        lockedReason: available ? undefined : lockedReason(c),
      });
    });

    return {
      treeId: this.tree!.id,
      nodeId: node.id,
      speaker: node.speaker ?? this.partner,
      text: t(node.text, { name: this.partner }),
      choices,
    };
  }

  /** The current turn, for a panel that needs to redraw. */
  current(): DialogueTurn | null {
    return this.node ? this.turn() : null;
  }

  /**
   * Take a choice by its index in the *authored* list.
   *
   * Indices are authored rather than filtered, so a hidden choice does not
   * silently renumber the ones after it — a gamepad reading position 2 must
   * mean the same thing on every device.
   */
  choose(index: number): { turn: DialogueTurn | null; outcome: ChoiceOutcome } | null {
    const node = this.node;
    const tree = this.tree;
    if (!node || !tree) return null;

    const choice = node.choices[index];
    if (!choice) return null;
    if (!availableChoices(node, this.ctx).includes(choice)) return null;

    const next = choice.to ? tree.nodes[choice.to] : null;
    const outcome: ChoiceOutcome = {
      consequences: choice.consequences ?? [],
      // The node's own effects land as you arrive; the choice's as you take it.
      relationship: mergeAxes(choice.effects, next?.effects),
      offersTask: choice.offersTask,
      ended: next === null,
    };

    if (!next) {
      this.log.push({ speaker: 'player', text: '', reply: t(choice.text) });
      this.end();
      return { turn: null, outcome };
    }

    return { turn: this.enter(next, t(choice.text)), outcome };
  }

  /**
   * Leave.
   *
   * Always available, on every node, whatever the tree says.
   * `validateDialogue` refuses a node whose every choice is gated, but a
   * player mid-conversation who wants out should not be relying on a
   * validator having done its job.
   */
  end(): void {
    this.tree = null;
    this.node = null;
  }
}

const NEUTRAL_AXES = {
  familiarity: 0,
  trust: 0,
  affection: 0,
  fear: 0,
  respect: 0,
} as const;

/**
 * Why a choice is greyed out — in the fiction, not in the schema.
 *
 * "Needs trust 0.3" is a spreadsheet. "You do not know them well enough for
 * that" is the same information in the game's own voice, and it is the
 * difference between a locked option that teaches and one that annoys.
 */
function lockedReason(c: StoryDialogueChoice): string {
  const req = c.requires;
  if (!req) return '';
  if (req.minPlayerAge !== undefined) return 'Not at your age.';
  const axes = req.atLeast ?? {};
  if (axes.trust !== undefined) return 'They do not trust you with that yet.';
  if (axes.affection !== undefined) return 'Too soon.';
  if (axes.respect !== undefined) return 'You have not earned that one.';
  if (axes.familiarity !== undefined) return 'You do not know them well enough.';
  return 'Not yet.';
}

function mergeAxes(
  a: StoryDialogueChoice['effects'],
  b: StoryDialogueChoice['effects'],
): StoryDialogueChoice['effects'] {
  if (!a) return b;
  if (!b) return a;
  const out: Record<string, number> = { ...a };
  for (const [axis, value] of Object.entries(b)) {
    out[axis] = (out[axis] ?? 0) + (value as number);
  }
  return out as StoryDialogueChoice['effects'];
}
