import type { RelationshipAxes } from './Relationships';

/**
 * What people say, as data.
 *
 * Two layers, because they answer different questions. **Barks** are one line
 * shouted at the world — the greeting as you pass, the muttering when a car
 * goes by too fast. Nobody stops walking for a bark. **Dialogue** is a
 * conversation you chose to have, with branches and consequences.
 *
 * Both are authored. Nothing here calls a model at runtime, and nothing here
 * should: a village of twenty people generating their own lines is a different
 * game with a different cost structure, and it is on the deferred list.
 */

export type BarkSituation =
  | 'greet'
  | 'farewell'
  | 'busy'
  | 'startled'
  | 'reproach'
  | 'idle'
  | 'night';

export interface BarkSet {
  readonly id: string;
  readonly lines: Readonly<Record<BarkSituation, readonly string[]>>;
}

const trader: BarkSet = {
  id: 'trader',
  lines: {
    greet: ['Morning to you.', 'Come in, come in.', 'You again — good.'],
    farewell: ['Mind how you go.', 'Come back before dark.'],
    busy: ['One moment, I am counting.', 'Stock day. Always stock day.'],
    startled: ['Careful!', 'Watch yourself!'],
    reproach: ['That is not how we do things here.', 'Someone will have seen that.'],
    idle: ['Slow hour.', 'The road is quiet today.'],
    night: ['Late to be out.', 'Everything is shut, you know.'],
  },
};

const gruff: BarkSet = {
  id: 'gruff',
  lines: {
    greet: ['Hm.', 'You need something?'],
    farewell: ['Right.', 'Go on, then.'],
    busy: ['Working.', 'Not now.'],
    startled: ['Oi!', 'Mind the tools!'],
    reproach: ['Do that again and we will talk properly.', 'I saw that.'],
    idle: ['Bolt is seized. Of course it is.'],
    night: ['Nothing open at this hour.'],
  },
};

const warm: BarkSet = {
  id: 'warm',
  lines: {
    greet: ['Hello, love.', 'There you are.', 'Good to see you.'],
    farewell: ['Take care now.', 'Safe home.'],
    busy: ['Give me a minute?', 'Hands full, sorry.'],
    startled: ['Oh!', 'Goodness.'],
    reproach: ['That was not kind.', 'I would rather you did not.'],
    idle: ['Lovely light today.', 'Washing will dry in an hour.'],
    night: ['You should be asleep.', 'Long day?'],
  },
};

const friend: BarkSet = {
  id: 'friend',
  lines: {
    greet: ['Hey!', 'You made it.', 'Where have you been?'],
    farewell: ['Later!', 'Text me.'],
    busy: ['Two minutes!', 'Almost done here.'],
    startled: ['Whoa!', 'Hey — careful.'],
    reproach: ['Not cool.', 'Seriously?'],
    idle: ['Bored. Extremely bored.', 'Nothing happens here.'],
    night: ['Sneaking out too?', 'Everyone is asleep.'],
  },
};

const elder: BarkSet = {
  id: 'elder',
  lines: {
    greet: ['Ah. Sit a while.', 'You have your father’s walk.'],
    farewell: ['Go well.', 'Come back and tell me about it.'],
    busy: ['Thinking. It takes longer now.'],
    startled: ['Steady!', 'My heart.'],
    reproach: ['I have seen where that road goes.', 'Your grandmother would have words.'],
    idle: ['The road was gravel once.', 'Forty years on this bench.'],
    night: ['I do not sleep much. You?'],
  },
};

const brisk: BarkSet = {
  id: 'brisk',
  lines: {
    greet: ['Morning.', 'All right?'],
    farewell: ['Right, off I go.', 'Cheers.'],
    busy: ['On a schedule, sorry.', 'Running late.'],
    startled: ['Hey!', 'Mind out!'],
    reproach: ['I will be reporting that.', 'Not on this street.'],
    idle: ['Traffic.', 'Six more stops.'],
    night: ['Night shift. You?'],
  },
};

export const BARK_SETS: readonly BarkSet[] = [trader, gruff, warm, friend, elder, brisk];

const BARKS_BY_ID = new Map(BARK_SETS.map((b) => [b.id, b]));

/**
 * Pick a line, deterministically.
 *
 * `salt` is normally something that changes slowly — the in-game hour, say —
 * so the same person greeting you twice in a row says the same thing, and
 * greeting you tomorrow says something else. Randomising per call gives a
 * character who cycles through their whole vocabulary while you stand there.
 */
export function pickBark(setId: string, situation: BarkSituation, salt: number): string | null {
  const set = BARKS_BY_ID.get(setId) ?? warm;
  const lines = set.lines[situation];
  if (!lines || lines.length === 0) return null;
  const index = Math.abs(Math.floor(salt)) % lines.length;
  return lines[index];
}

// ---------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------

export interface DialogueCondition {
  /** Minimum values on the listed axes. Absent axes are unconstrained. */
  readonly atLeast?: Partial<RelationshipAxes>;
  readonly minPlayerAge?: number;
}

export interface DialogueChoice {
  readonly text: string;
  /** Next node id, or null to end the conversation. */
  readonly to: string | null;
  readonly requires?: DialogueCondition;
  readonly effects?: Partial<RelationshipAxes>;
  /** A task this choice offers. Phase 7 gives these meaning. */
  readonly offersTask?: string;
}

export interface DialogueNode {
  readonly id: string;
  readonly text: string;
  readonly choices: readonly DialogueChoice[];
  readonly effects?: Partial<RelationshipAxes>;
}

export interface DialogueTree {
  readonly id: string;
  readonly root: string;
  readonly nodes: Readonly<Record<string, DialogueNode>>;
}

export interface DialogueContext {
  readonly relationship: RelationshipAxes;
  readonly playerAge: number;
}

export function choiceAvailable(choice: DialogueChoice, ctx: DialogueContext): boolean {
  const req = choice.requires;
  if (!req) return true;
  if (req.minPlayerAge !== undefined && ctx.playerAge < req.minPlayerAge) return false;
  for (const [axis, min] of Object.entries(req.atLeast ?? {})) {
    if (ctx.relationship[axis as keyof RelationshipAxes] < (min as number)) return false;
  }
  return true;
}

/** Choices the player may actually pick, in authored order. */
export function availableChoices(
  node: DialogueNode,
  ctx: DialogueContext,
): DialogueChoice[] {
  return node.choices.filter((c) => choiceAvailable(c, ctx));
}

export interface DialogueIssue {
  readonly tree: string;
  readonly code: string;
  readonly message: string;
}

/**
 * Catch the ways a dialogue tree strands a player.
 *
 * A node whose every choice is gated behind a relationship the player does not
 * have is a conversation with no exit, and it is the failure a hand-written
 * tree reaches first. Unreachable nodes are the other half: authored, paid
 * for, never seen.
 */
export function validateDialogue(tree: DialogueTree): DialogueIssue[] {
  const issues: DialogueIssue[] = [];
  const push = (code: string, message: string) => issues.push({ tree: tree.id, code, message });

  if (!tree.nodes[tree.root]) {
    push('missing-root', `root node ${tree.root} does not exist`);
    return issues;
  }

  for (const node of Object.values(tree.nodes)) {
    if (node.choices.length === 0) {
      push('dead-end', `node ${node.id} offers no choices, not even to leave`);
    }
    if (!node.choices.some((c) => !c.requires)) {
      push('all-gated', `every choice on node ${node.id} is conditional; it can trap the player`);
    }
    for (const c of node.choices) {
      if (c.to !== null && !tree.nodes[c.to]) {
        push('missing-target', `choice on ${node.id} points at missing node ${c.to}`);
      }
    }
  }

  const reachable = new Set<string>();
  const stack = [tree.root];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const c of tree.nodes[id]?.choices ?? []) {
      if (c.to) stack.push(c.to);
    }
  }
  for (const id of Object.keys(tree.nodes)) {
    if (!reachable.has(id)) push('unreachable', `node ${id} cannot be reached from the root`);
  }

  return issues;
}

/**
 * The one conversation every named resident can have.
 *
 * Deliberately generic and deliberately short. Phase 8 writes the authored
 * trees; what this phase owes is a working data path from "press E on a
 * resident" through a branch, a condition and a relationship effect, so that
 * when the story arrives there is nothing left to invent.
 */
export const SMALL_TALK: DialogueTree = {
  id: 'small_talk',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      text: '{name} looks up.',
      choices: [
        { text: 'Say hello.', to: 'hello', effects: { familiarity: 0.04 } },
        { text: 'Ask how things are.', to: 'howAre', effects: { familiarity: 0.03 } },
        {
          text: 'Ask whether they need anything.',
          to: 'favour',
          requires: { atLeast: { familiarity: 0.3 } },
        },
        { text: 'Nod and move on.', to: null },
      ],
    },
    hello: {
      id: 'hello',
      text: 'A short greeting, and a small pause.',
      effects: { affection: 0.01 },
      choices: [{ text: 'Leave it there.', to: null }],
    },
    howAre: {
      id: 'howAre',
      text: 'They tell you about the week. Some of it is even interesting.',
      effects: { familiarity: 0.02, affection: 0.02 },
      choices: [
        { text: 'Listen properly.', to: 'listened', effects: { trust: 0.03, affection: 0.03 } },
        { text: 'Make an excuse.', to: null, effects: { affection: -0.02 } },
      ],
    },
    listened: {
      id: 'listened',
      text: 'They seem glad you asked.',
      choices: [{ text: 'Head off.', to: null }],
    },
    favour: {
      id: 'favour',
      text: 'There is something, as it happens.',
      choices: [
        { text: 'Offer to help.', to: null, effects: { trust: 0.05, respect: 0.04 }, offersTask: 'errand' },
        { text: 'Say another time.', to: null },
      ],
    },
  },
};
