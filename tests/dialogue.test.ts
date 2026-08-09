import { describe, it, expect } from 'vitest';
import {
  BARK_SETS,
  SMALL_TALK,
  availableChoices,
  choiceAvailable,
  pickBark,
  validateDialogue,
  type DialogueTree,
} from '../src/npc/Dialogue';
import { NEUTRAL } from '../src/npc/Relationships';

describe('barks', () => {
  it('ships a line for every situation in every set', () => {
    const situations = [
      'greet',
      'farewell',
      'busy',
      'startled',
      'reproach',
      'idle',
      'night',
    ] as const;
    for (const set of BARK_SETS) {
      for (const s of situations) {
        expect(set.lines[s].length, `${set.id}.${s}`).toBeGreaterThan(0);
      }
    }
  });

  it('is deterministic for the same salt', () => {
    // Salted with the hour, so somebody greeted twice in a minute says the same
    // thing rather than cycling their whole vocabulary while you stand there.
    expect(pickBark('trader', 'greet', 9)).toBe(pickBark('trader', 'greet', 9));
  });

  it('varies with the salt', () => {
    const lines = new Set([0, 1, 2, 3, 4].map((h) => pickBark('trader', 'greet', h)));
    expect(lines.size).toBeGreaterThan(1);
  });

  it('handles a negative or fractional salt', () => {
    expect(pickBark('trader', 'greet', -3)).toBeTruthy();
    expect(pickBark('trader', 'greet', 7.8)).toBeTruthy();
  });

  it('falls back rather than returning nothing for an unknown set', () => {
    expect(pickBark('no_such_set', 'greet', 1)).toBeTruthy();
  });
});

describe('choice conditions', () => {
  const ctx = { relationship: { ...NEUTRAL }, playerAge: 15 };

  it('allows an unconditional choice', () => {
    expect(choiceAvailable({ text: 'Hi', to: null }, ctx)).toBe(true);
  });

  it('gates on a relationship axis', () => {
    const choice = { text: 'Ask a favour', to: null, requires: { atLeast: { trust: 0.5 } } };
    expect(choiceAvailable(choice, ctx)).toBe(false);
    expect(
      choiceAvailable(choice, { ...ctx, relationship: { ...NEUTRAL, trust: 0.6 } }),
    ).toBe(true);
  });

  it('gates on player age', () => {
    const adult = { text: 'Buy a round', to: null, requires: { minPlayerAge: 18 } };
    expect(choiceAvailable(adult, ctx)).toBe(false);
    expect(choiceAvailable(adult, { ...ctx, playerAge: 18 })).toBe(true);
  });

  it('requires every listed axis, not just one', () => {
    const choice = {
      text: 'Confide',
      to: null,
      requires: { atLeast: { trust: 0.5, affection: 0.5 } },
    };
    expect(
      choiceAvailable(choice, { ...ctx, relationship: { ...NEUTRAL, trust: 0.9 } }),
    ).toBe(false);
  });
});

describe('small talk', () => {
  it('is structurally sound', () => {
    expect(validateDialogue(SMALL_TALK)).toEqual([]);
  });

  it('always offers a stranger something to say', () => {
    // The trap this guards: a node whose every choice is gated behind a
    // relationship the player does not have is a conversation with no exit.
    const root = SMALL_TALK.nodes[SMALL_TALK.root];
    const choices = availableChoices(root, { relationship: { ...NEUTRAL }, playerAge: 15 });
    expect(choices.length).toBeGreaterThan(0);
  });

  it('opens a branch once the player is familiar enough', () => {
    const root = SMALL_TALK.nodes[SMALL_TALK.root];
    const stranger = availableChoices(root, { relationship: { ...NEUTRAL }, playerAge: 15 });
    const friend = availableChoices(root, {
      relationship: { ...NEUTRAL, familiarity: 0.5 },
      playerAge: 15,
    });
    expect(friend.length).toBeGreaterThan(stranger.length);
  });

  it('can always be left', () => {
    const root = SMALL_TALK.nodes[SMALL_TALK.root];
    expect(root.choices.some((c) => c.to === null)).toBe(true);
  });
});

describe('dialogue validation', () => {
  it('flags a missing root', () => {
    const tree: DialogueTree = { id: 't', root: 'nope', nodes: {} };
    expect(validateDialogue(tree).map((i) => i.code)).toContain('missing-root');
  });

  it('flags a choice pointing at a node that does not exist', () => {
    const tree: DialogueTree = {
      id: 't',
      root: 'a',
      nodes: { a: { id: 'a', text: '', choices: [{ text: 'go', to: 'ghost' }] } },
    };
    expect(validateDialogue(tree).map((i) => i.code)).toContain('missing-target');
  });

  it('flags a node with no way out', () => {
    const tree: DialogueTree = {
      id: 't',
      root: 'a',
      nodes: { a: { id: 'a', text: '', choices: [] } },
    };
    expect(validateDialogue(tree).map((i) => i.code)).toContain('dead-end');
  });

  it('flags a node where every choice is conditional', () => {
    const tree: DialogueTree = {
      id: 't',
      root: 'a',
      nodes: {
        a: {
          id: 'a',
          text: '',
          choices: [{ text: 'only if', to: null, requires: { atLeast: { trust: 0.9 } } }],
        },
      },
    };
    expect(validateDialogue(tree).map((i) => i.code)).toContain('all-gated');
  });

  it('flags a node nothing can reach', () => {
    const tree: DialogueTree = {
      id: 't',
      root: 'a',
      nodes: {
        a: { id: 'a', text: '', choices: [{ text: 'end', to: null }] },
        orphan: { id: 'orphan', text: '', choices: [{ text: 'end', to: null }] },
      },
    };
    expect(validateDialogue(tree).map((i) => i.code)).toContain('unreachable');
  });

  it('does not loop forever on a cyclic tree', () => {
    const tree: DialogueTree = {
      id: 't',
      root: 'a',
      nodes: {
        a: { id: 'a', text: '', choices: [{ text: 'b', to: 'b' }, { text: 'end', to: null }] },
        b: { id: 'b', text: '', choices: [{ text: 'a', to: 'a' }, { text: 'end', to: null }] },
      },
    };
    expect(validateDialogue(tree)).toEqual([]);
  });
});
