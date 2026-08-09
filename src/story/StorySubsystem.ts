/**
 * Everything about the authored story that a Free Roam player never needs, in
 * one lazily-imported module.
 *
 * The split follows the same line Phase 7 drew for interiors: **what does the
 * save layer and the HUD touch on the first frame?** That, and only that, is
 * eager.
 *
 * Eager, in `StoryState.ts`:
 *
 * - flags, recorded choices, two reputation numbers, the reel's event list,
 *   quest positions and the paid-reward keys. All of it is in the save format,
 *   and `SaveService` has to read and write it whether or not a quest has ever
 *   been loaded — the same argument that keeps `RelationshipStore` above
 *   `Population`.
 *
 * Lazy, behind this file:
 *
 * - the catalogue (35 quests), the 15 dialogue trees, the 9 cutscenes, the 13
 *   endings, the string table and the Life Reel renderer. None of it is
 *   reachable until Story Mode actually starts, which happens behind the mode
 *   selector's own loading screen.
 *
 * `storyValidation.ts` is deliberately **not** re-exported. It pulls in the
 * NPC and task catalogues to check ids against them, and dragging those onto
 * any runtime path to re-run a check the build already ran would be exactly
 * backwards. Tests and `scripts/check-story.mjs` import it directly.
 */

export { StoryDirector, type StoryDirectorHost } from './StoryDirector';
// The three Story-Mode panels. Here rather than in `HUD` because the app chunk
// went over its limit when they were there — see the note at the top of the file.
export { StoryPanels, type JournalEntry, type TurnLine } from '../ui/StoryPanels';
export { STORY_PLACES, storyPlace, placesInZone, type StoryPlace } from './storyPlaces';
export { QuestSystem, type QuestView, type ObjectiveView, type ProgressReport, type StoryEvent, type StoryHost } from './QuestSystem';
export { QUESTS, CHAPTERS, OPENING_QUEST, questDef, chapterOf, MAIN_QUEST_IDS, SIDE_QUEST_IDS } from './storyCatalog';
export { DialogueRunner, type DialogueTurn, type ChoiceView, type ChoiceOutcome } from './DialogueRunner';
export { DIALOGUE_TREES, dialogueTree, type StoryDialogueTree } from './dialogueCatalog';
export { CutscenePlayer, CUTSCENES, cutscene, sceneLength, type CutsceneDef, type CutsceneHost } from './Cutscenes';
export { ENDINGS, ENDING_FAMILIES, endingById, endingsOf, familyFromFlags, resolveEnding, type EndingDef, type EndingFamily } from './Endings';
export {
  buildReel,
  exportReel,
  downloadReel,
  postcardFor,
  renderReel,
  sanitiseName,
  REEL_WIDTH,
  REEL_HEIGHT,
  type ReelFacts,
  type ReelModel,
} from './LifeReel';
export { t, hasString, STRINGS } from './strings';
export {
  checkpointBefore,
  objectiveTarget,
  rewardKey,
  stageOf,
  type Consequence,
  type QuestDef,
  type QuestReward,
  type QuestStage,
  type StoryCondition,
} from './QuestDefinition';
