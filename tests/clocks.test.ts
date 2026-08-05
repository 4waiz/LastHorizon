import { describe, it, expect } from 'vitest';
import { LifeClock, MAX_AGE, MIN_AGE } from '../src/core/clocks/LifeClock';
import { WorldClock, DAY_LENGTH_SECONDS } from '../src/core/clocks/WorldClock';
import { StoryClock } from '../src/core/clocks/StoryClock';

const MINUTE = 60;
const HOUR = 60 * MINUTE;

describe('LifeClock — one active hour is one year', () => {
  it('exactly 60 active minutes produces exactly one birthday', () => {
    const c = new LifeClock(15, 60);
    const tick = c.advance(HOUR);
    expect(tick.birthdayReached).toBe(16);
    // Consumed exactly the hour, not a fraction more.
    expect(tick.consumed).toBeCloseTo(HOUR, 6);
    expect(c.acknowledgeBirthday()).toBe(16);
    expect(c.pendingBirthday).toBeNull();
  });

  it('does not reach a birthday a second early', () => {
    const c = new LifeClock(15, 60);
    for (let i = 0; i < 59; i++) expect(c.advance(MINUTE).birthdayReached).toBeNull();
    expect(c.ageYears).toBe(15);
    expect(c.advance(MINUTE).birthdayReached).toBe(16);
  });

  it('stops at the boundary rather than sailing past it', () => {
    const c = new LifeClock(15, 60);
    // Two hours in one go: only the first birthday is reached.
    const tick = c.advance(2 * HOUR);
    expect(tick.birthdayReached).toBe(16);
    expect(tick.consumed).toBeCloseTo(HOUR, 6);
    expect(c.ageYears).toBe(15); // not aged until acknowledged
  });

  it('leaps several birthdays without losing the overflow', () => {
    const c = new LifeClock(15, 60);
    c.advance(2 * HOUR);
    // The carried second hour delivers the next birthday on acknowledgement.
    expect(c.acknowledgeBirthday()).toBe(16);
    expect(c.pendingBirthday).toBe(17);
    expect(c.acknowledgeBirthday()).toBe(17);
    expect(c.pendingBirthday).toBeNull();
    expect(c.ageYears).toBe(17);
  });

  it('does not advance while a birthday is unhandled', () => {
    const c = new LifeClock(15, 60);
    c.advance(HOUR);
    const before = c.yearProgress;
    expect(c.advance(10 * MINUTE).consumed).toBe(0);
    expect(c.yearProgress).toBe(before);
  });
});

describe('LifeClock — activity gating', () => {
  const reasons = ['hidden', 'paused', 'loading', 'settings', 'saveMigration', 'photoMode'] as const;

  for (const reason of reasons) {
    it(`does not age while ${reason}`, () => {
      const c = new LifeClock(15, 60);
      c.block(reason);
      expect(c.advance(2 * HOUR).consumed).toBe(0);
      expect(c.yearProgress).toBe(0);
      c.unblock(reason);
      expect(c.advance(MINUTE).consumed).toBe(MINUTE);
    });
  }

  it('needs every block released, not just one', () => {
    const c = new LifeClock(15, 60);
    c.block('hidden');
    c.block('saveMigration');
    c.unblock('hidden');
    expect(c.advance(MINUTE).consumed).toBe(0);
    c.unblock('saveMigration');
    expect(c.advance(MINUTE).consumed).toBe(MINUTE);
  });

  it('reports why it is blocked, deterministically ordered', () => {
    const c = new LifeClock();
    c.block('photoMode');
    c.block('hidden');
    expect(c.blockReasons).toEqual(['hidden', 'photoMode']);
  });

  it('never ages when frozen, however long the session', () => {
    const c = new LifeClock(15, 'frozen');
    expect(c.advance(50 * HOUR).consumed).toBe(0);
    expect(c.ageYears).toBe(15);
    expect(c.forceBirthday()).toBeNull();
  });

  it('ignores nonsense input rather than trusting it', () => {
    const c = new LifeClock(15, 60);
    for (const bad of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(c.advance(bad).consumed).toBe(0);
    }
    expect(c.yearProgress).toBe(0);
  });
});

describe('LifeClock — rate changes', () => {
  it('honours 30 minutes per year', () => {
    const c = new LifeClock(15, 30);
    expect(c.advance(30 * MINUTE).birthdayReached).toBe(16);
  });

  it('honours 120 minutes per year', () => {
    const c = new LifeClock(15, 120);
    expect(c.advance(HOUR).birthdayReached).toBeNull();
    expect(c.advance(HOUR).birthdayReached).toBe(16);
  });

  it('preserves progress as a fraction when the rate changes', () => {
    const c = new LifeClock(15, 60);
    c.advance(30 * MINUTE); // half a year at 60
    expect(c.yearProgress).toBeCloseTo(0.5, 6);
    c.setRate(120);
    // Still half way through the year, so an hour of the new rate finishes it.
    expect(c.yearProgress).toBeCloseTo(0.5, 6);
    expect(c.advance(HOUR).birthdayReached).toBe(16);
  });

  it('can be frozen mid-year and thawed without losing progress', () => {
    const c = new LifeClock(15, 60);
    c.advance(30 * MINUTE);
    c.setRate('frozen');
    expect(c.advance(10 * HOUR).consumed).toBe(0);
    c.setRate(60);
    expect(c.yearProgress).toBeCloseTo(0.5, 6);
  });
});

describe('LifeClock — once-only delivery across reload', () => {
  it('restores age and progress without replaying a handled birthday', () => {
    const c = new LifeClock(15, 60);
    c.advance(HOUR);
    c.acknowledgeBirthday();
    c.advance(15 * MINUTE);

    const restored = new LifeClock();
    restored.restore(c.snapshot());
    expect(restored.ageYears).toBe(16);
    expect(restored.yearProgress).toBeCloseTo(0.25, 6);
    expect(restored.pendingBirthday).toBeNull();
  });

  it('re-arms a birthday that was reached but never handled', () => {
    const c = new LifeClock(15, 60);
    c.advance(HOUR);
    expect(c.pendingBirthday).toBe(16);
    // Closed mid-birthday: the snapshot sits exactly on the boundary.
    const restored = new LifeClock();
    restored.restore(c.snapshot());
    // Safe reading is "not finished", so it fires once more rather than never.
    expect(restored.pendingBirthday).toBe(16);
    expect(restored.acknowledgeBirthday()).toBe(16);
    expect(restored.pendingBirthday).toBeNull();
  });

  it('knows which birthdays are already handled', () => {
    const c = new LifeClock(15, 60);
    c.advance(HOUR);
    c.acknowledgeBirthday();
    expect(c.hasHandled(16)).toBe(true);
    expect(c.hasHandled(17)).toBe(false);
  });

  it('acknowledging twice is not two birthdays', () => {
    const c = new LifeClock(15, 60);
    c.advance(HOUR);
    expect(c.acknowledgeBirthday()).toBe(16);
    expect(c.acknowledgeBirthday()).toBeNull();
    expect(c.ageYears).toBe(16);
  });

  it('clamps a restored age into the supported range', () => {
    const c = new LifeClock();
    c.restore({ ageYears: 999, yearProgress: 0.5, lastHandledAge: 999, rate: 60, activeSeconds: 0 });
    expect(c.ageYears).toBe(MAX_AGE);
    c.restore({ ageYears: 2, yearProgress: 0, lastHandledAge: 2, rate: 60, activeSeconds: 0 });
    expect(c.ageYears).toBe(MIN_AGE);
  });

  it('stops ageing at the supported maximum', () => {
    const c = new LifeClock(MAX_AGE, 60);
    expect(c.advance(10 * HOUR).consumed).toBe(0);
    expect(c.ageYears).toBe(MAX_AGE);
  });
});

describe('LifeClock — forced birthday, for tests only', () => {
  it('reaches the next birthday without waiting an hour', () => {
    const c = new LifeClock(15, 60);
    expect(c.forceBirthday()).toBe(16);
    expect(c.acknowledgeBirthday()).toBe(16);
    expect(c.ageYears).toBe(16);
  });

  it('does not stack pending birthdays', () => {
    const c = new LifeClock(15, 60);
    c.forceBirthday();
    expect(c.forceBirthday()).toBe(16);
  });
});

describe('WorldClock — independent of ageing', () => {
  it('completes a day in its own fixed time, whatever the life rate', () => {
    const w = new WorldClock();
    const before = w.day;
    w.advance(DAY_LENGTH_SECONDS);
    expect(w.day).toBe(before + 1);
  });

  it('does not advance when locked to a mode', () => {
    const w = new WorldClock();
    w.setMode('night');
    const t = w.time;
    w.advance(DAY_LENGTH_SECONDS);
    expect(w.time).toBe(t);
  });

  it('does not advance while paused', () => {
    const w = new WorldClock();
    const t = w.time;
    w.setPaused(true);
    w.advance(DAY_LENGTH_SECONDS / 2);
    expect(w.time).toBe(t);
  });

  it('counts a new day when the clock wraps backwards', () => {
    const w = new WorldClock();
    w.jumpTo(0.9);
    const day = w.day;
    w.jumpTo(0.1);
    expect(w.day).toBe(day + 1);
  });

  it('formats a readable label', () => {
    const w = new WorldClock();
    w.jumpTo(0.5);
    expect(w.clockLabel()).toBe('12:00');
    w.jumpTo(0);
    expect(w.clockLabel()).toBe('00:00');
  });

  it('survives a round trip through a snapshot', () => {
    const w = new WorldClock();
    w.setMode('dusk');
    w.jumpTo(0.42);
    const b = new WorldClock();
    b.restore(w.snapshot());
    expect(b.time).toBeCloseTo(0.42, 6);
    expect(b.mode).toBe('dusk');
  });
});

describe('StoryClock — quest time', () => {
  it('tracks chapter and total time separately', () => {
    const s = new StoryClock();
    s.advance(100);
    s.setChapter(2);
    s.advance(50);
    expect(s.chapterSeconds).toBe(50);
    expect(s.totalSeconds).toBe(150);
  });

  it('expires a timer exactly once, and reports it', () => {
    const s = new StoryClock();
    s.startTimer('grocery_shift', 30);
    expect(s.advance(20)).toEqual([]);
    expect(s.advance(15)).toEqual(['grocery_shift']);
    expect(s.advance(15)).toEqual([]);
    expect(s.hasTimer('grocery_shift')).toBe(false);
  });

  it('reports several expiries in a deterministic order', () => {
    const s = new StoryClock();
    s.startTimer('zebra', 5);
    s.startTimer('apple', 5);
    expect(s.advance(10)).toEqual(['apple', 'zebra']);
  });

  it('does not run timers while paused', () => {
    const s = new StoryClock();
    s.startTimer('t', 10);
    s.setPaused(true);
    expect(s.advance(60)).toEqual([]);
    expect(s.remaining('t')).toBe(10);
  });

  it('drops chapter timers when the chapter changes', () => {
    const s = new StoryClock();
    s.startTimer('t', 10);
    s.setChapter(3);
    expect(s.hasTimer('t')).toBe(false);
  });

  it('round-trips timers through a snapshot', () => {
    const s = new StoryClock();
    s.setChapter(4);
    s.startTimer('deadline', 42);
    const b = new StoryClock();
    b.restore(s.snapshot());
    expect(b.chapter).toBe(4);
    expect(b.remaining('deadline')).toBe(42);
  });
});

describe('the three clocks are genuinely independent', () => {
  it('freezing ageing leaves the day and quest timers running', () => {
    const life = new LifeClock(15, 'frozen');
    const world = new WorldClock();
    const story = new StoryClock();
    story.startTimer('t', 10);

    life.advance(HOUR);
    world.advance(HOUR);
    const expired = story.advance(HOUR);

    expect(life.ageYears).toBe(15);
    expect(world.time).not.toBe(0.615);
    expect(expired).toEqual(['t']);
  });

  it('locking the sky to dusk leaves ageing running', () => {
    const life = new LifeClock(15, 60);
    const world = new WorldClock();
    world.setMode('dusk');

    world.advance(HOUR);
    const tick = life.advance(HOUR);

    expect(world.time).toBe(0.8);
    expect(tick.birthdayReached).toBe(16);
  });
});
