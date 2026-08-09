import { MAIN_QUESTS } from './mainStory';
import { SIDE_QUESTS } from './sideStory';
import type { QuestDef } from './QuestDefinition';

/**
 * The index over the authored story.
 *
 * One place that knows every quest, so `QuestSystem` can be handed a lookup
 * and stay ignorant of where the content lives. Nothing here evaluates
 * anything; it is a map and seven rows of chapter metadata.
 */

export const QUESTS: readonly QuestDef[] = [...MAIN_QUESTS, ...SIDE_QUESTS];

const BY_ID = new Map(QUESTS.map((q) => [q.id, q]));

export function questDef(id: string): QuestDef | null {
  return BY_ID.get(id) ?? null;
}

export function questsOfChapter(chapter: number): readonly QuestDef[] {
  return QUESTS.filter((q) => q.chapter === chapter);
}

export const MAIN_QUEST_IDS: readonly string[] = MAIN_QUESTS.map((q) => q.id);
export const SIDE_QUEST_IDS: readonly string[] = SIDE_QUESTS.map((q) => q.id);

export interface ChapterDef {
  readonly number: number;
  readonly id: string;
  readonly titleKey: string;
  /** The age the chapter opens at. */
  readonly age: number;
  /** The quest that finishes it. */
  readonly closesOn: string;
}

/**
 * The seven chapters.
 *
 * `id` is what `Gates` and the save's `completedChapters` deal in, and
 * `village_departure` is deliberately *not* one of these ids: it is a
 * milestone inside chapter 4 rather than the chapter itself, and it has been
 * the city's gate since Phase 3. Renaming it to fit a tidier scheme would
 * silently unlock the city for every existing save.
 */
export const CHAPTERS: readonly ChapterDef[] = [
  { number: 1, id: 'chapter_1', titleKey: 'chapter.1', age: 15, closesOn: 'q1_the_road' },
  { number: 2, id: 'chapter_2', titleKey: 'chapter.2', age: 16, closesOn: 'q2_the_bicycle' },
  { number: 3, id: 'chapter_3', titleKey: 'chapter.3', age: 17, closesOn: 'q3_the_crack' },
  { number: 4, id: 'chapter_4', titleKey: 'chapter.4', age: 18, closesOn: 'q4_city_job' },
  { number: 5, id: 'chapter_5', titleKey: 'chapter.5', age: 19, closesOn: 'q5_someone' },
  { number: 6, id: 'chapter_6', titleKey: 'chapter.6', age: 22, closesOn: 'q6_the_offer' },
  { number: 7, id: 'chapter_7', titleKey: 'chapter.7', age: 25, closesOn: 'q7_last_horizon' },
];

export function chapterOf(number: number): ChapterDef | null {
  return CHAPTERS.find((c) => c.number === number) ?? null;
}

/** The first main quest of the story. What "start a new run" begins. */
export const OPENING_QUEST = 'q1_keepsakes';
