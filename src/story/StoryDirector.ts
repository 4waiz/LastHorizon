import { QuestSystem, type ProgressReport, type StoryEvent, type StoryHost } from './QuestSystem';
import { DialogueRunner, type DialogueTurn } from './DialogueRunner';
import { CutscenePlayer, cutscene, type CutsceneHost } from './Cutscenes';
import { dialogueTree } from './dialogueCatalog';
import { OPENING_QUEST, questDef, QUESTS } from './storyCatalog';
import { storyPlace } from './storyPlaces';
import { familyFromFlags, resolveEnding } from './Endings';
import { buildReel, postcardFor, type ReelFacts, type ReelModel } from './LifeReel';
import { t } from './strings';
import type { StoryState } from './StoryState';
import type { RelationshipAxes } from '../npc/Relationships';
import type { ZoneId } from '../world/zones/Manifest';

/**
 * The one thing that drives the story.
 *
 * `Game` holds a handle to this and calls four methods: `update`, `report`,
 * `talkTo` and `begin`. Everything else — which stage is current, whether a
 * scene should play, when a travel objective is satisfied, what the HUD's
 * objective line says — happens in here.
 *
 * That is the brief's "no quest logic hidden in UI components" made
 * structural. The HUD is handed a *string*; it has never heard of a stage.
 *
 * This module is behind the story's lazy import along with the catalogue, so
 * a Free Roam player never downloads it.
 */

export interface StoryDirectorHost extends StoryHost, CutsceneHost {
  toast(title: string, body: string): void;
  /** The HUD's one-line objective. Null clears it. */
  setObjective(text: string | null): void;
  npcName(id: string): string;
  activeZone(): ZoneId | null;
  /** Interior point positions, when a room is open. */
  interiorPoint(name: string): { x: number; y: number; z: number } | null;
  /** How many of an item the player is holding. */
  holds(itemId: string): number;
  /** Hand some over. False when there were not that many. */
  take(itemId: string, count: number): boolean;
}

export class StoryDirector {
  readonly quests: QuestSystem;
  readonly dialogue = new DialogueRunner();
  readonly scenes: CutscenePlayer;

  /** Metres covered in a vehicle since the last report. */
  private drivenMetres = 0;
  private lastObjective: string | null = null;
  private pendingScene: string | null = null;
  private travelCheckTimer = 0;

  constructor(
    private readonly state: StoryState,
    private readonly host: StoryDirectorHost,
  ) {
    this.quests = new QuestSystem(state, (id) => questDef(id), host, () => QUESTS);
    this.scenes = new CutscenePlayer(host);
  }

  /**
   * Open chapter 1.
   *
   * Idempotent — calling it on a run that is already underway does nothing,
   * because `QuestSystem.start` refuses a quest that is running or complete.
   * That matters because this is called both from "new game" and from a load.
   */
  begin(): void {
    this.quests.start(OPENING_QUEST);
    this.quests.repairAfterRestore();
  }

  /** After a save is applied. Repairs runs naming stages this build lacks. */
  afterRestore(): string[] {
    return this.quests.repairAfterRestore();
  }

  // -- the frame -----------------------------------------------------------

  update(dt: number): void {
    if (this.scenes.playing) {
      this.scenes.advance(dt);
      // Events still drain. A browser run found out why: a quest that
      // completed while its own scene was playing left the `completed` event
      // in the queue forever, so the chapter-7 ending was never resolved and
      // the run finished with a blank card. Stage timers and travel checks are
      // right to pause — the player has no controls — but an event that has
      // already happened is not waiting on anything.
      this.drainEvents();
      return;
    }

    this.quests.advance(dt);
    this.checkTravel(dt);
    this.drainEvents();
    this.syncObjective();
  }

  /**
   * Travel and follow objectives, on a timer rather than every frame.
   *
   * Four times a second is far more often than anybody walks six metres, and
   * it keeps a per-frame distance check off the hot path — the occlusion
   * raycast is already the largest item in this frame and Phase 6 said so.
   */
  private checkTravel(dt: number): void {
    this.travelCheckTimer += dt;
    if (this.travelCheckTimer < 0.25) return;
    this.travelCheckTimer = 0;

    const p = this.host.playerPosition();
    const zone = this.host.activeZone();

    for (const view of this.quests.activeQuests()) {
      for (const o of view.objectives) {
        if (o.complete) continue;

        if (o.kind === 'travel' && o.zone !== undefined) {
          if (o.zone === zone) this.quests.report(view.id, { objectiveId: o.id }, 1);
          continue;
        }
        // `park` is deliberately absent. Walking into the bay on foot would
        // complete "park in the bay", which it plainly is not — parking is the
        // act of *leaving a vehicle* somewhere, and the host reports it from
        // `exitVehicle`.
        if (o.kind === 'travel' && o.place) {
          if (this.within(o.place, p)) this.quests.report(view.id, { objectiveId: o.id }, 1);
          continue;
        }

        // A delivery is "be there, holding it" — and the item is actually
        // handed over, because a parcel you keep is a parcel you did not
        // deliver. Doing it here rather than at a counter is what lets a drop
        // be somewhere with no counter at all, which most of them are.
        if (o.kind === 'deliver' && o.place && o.itemId) {
          if (!this.within(o.place, p)) continue;
          const want = Math.min(o.target - o.done, this.host.holds(o.itemId));
          if (want > 0 && this.host.take(o.itemId, want)) {
            this.quests.report(view.id, { objectiveId: o.id }, want);
          }
          continue;
        }

        // Getting clear: distance from wherever the stage began. Recorded on
        // the first check rather than on stage entry, because the stage may
        // have been entered in another zone.
        if (o.kind === 'escape') {
          const from = this.escapeOrigin.get(`${view.id}/${o.id}`);
          if (!from) {
            this.escapeOrigin.set(`${view.id}/${o.id}`, { x: p.x, z: p.z });
            continue;
          }
          const away = Math.hypot(p.x - from.x, p.z - from.z);
          this.quests.setProgress(view.id, o.id, Math.floor(away));
        }
      }
    }
  }

  /** Where an `escape` objective started measuring from. */
  private readonly escapeOrigin = new Map<string, { x: number; z: number }>();

  private within(place: string, p: { x: number; z: number }): boolean {
    const target = this.resolvePlace(place);
    if (!target) return false;
    const radius = storyPlace(place)?.radius ?? 4;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    return dx * dx + dz * dz <= radius * radius;
  }

  /**
   * A vehicle was left somewhere. Does anywhere named claim it?
   *
   * Called by the host on a successful exit, because *that* is what parking
   * is. Reports against the place the vehicle is standing in, not the player —
   * you can step away from a correctly parked van.
   */
  reportParked(x: number, z: number): void {
    for (const view of this.quests.activeQuests()) {
      for (const o of view.objectives) {
        if (o.kind !== 'park' || o.complete || !o.place) continue;
        const target = this.resolvePlace(o.place);
        if (!target) continue;
        const radius = storyPlace(o.place)?.radius ?? 6;
        const dx = target.x - x;
        const dz = target.z - z;
        if (dx * dx + dz * dz <= radius * radius) {
          this.quests.report(view.id, { objectiveId: o.id }, 1);
        }
      }
    }
  }

  /** Interiors first: a room that is open owns the name while you are in it. */
  resolvePlace(name: string): { x: number; y: number; z: number } | null {
    const inside = this.host.interiorPoint(name);
    if (inside) return inside;

    const place = storyPlace(name);
    if (!place || place.zone !== this.host.activeZone()) return null;
    return { x: place.x, y: 0, z: place.z };
  }

  private drainEvents(): void {
    for (const e of this.quests.drainEvents()) this.present(e);
  }

  private present(e: StoryEvent): void {
    switch (e.kind) {
      case 'started': {
        const def = questDef(e.questId);
        if (def) this.host.toast(t('ui.quest.started', { title: t(def.titleKey) }), t(def.summaryKey));
        break;
      }
      case 'completed': {
        const def = questDef(e.questId);
        if (def) {
          this.host.toast(
            t('ui.quest.completed', { title: t(def.titleKey) }),
            e.outcomeKey ? t(e.outcomeKey) : '',
          );
        }
        if (e.questId === 'q7_last_horizon') this.settleEnding();
        break;
      }
      case 'failed':
        this.host.toast(t('ui.quest.failed'), e.messageKey ? t(e.messageKey) : '');
        break;
      case 'reward':
        this.host.toast(t('ui.quest.reward', { money: e.money }), '');
        break;
      case 'stage':
        // A scene is queued rather than played here: `present` runs inside the
        // frame, and starting a scene awaits a fade.
        if (e.sceneId) this.pendingScene = e.sceneId;
        break;
    }
  }

  /** Called by the host outside the frame, so the fade can be awaited. */
  async playPendingScene(): Promise<boolean> {
    const id = this.pendingScene;
    this.pendingScene = null;
    if (!id) return false;
    const def = cutscene(id);
    if (!def) return false;
    await this.scenes.play(def);
    return true;
  }

  get hasPendingScene(): boolean {
    return this.pendingScene !== null;
  }

  /**
   * The HUD line.
   *
   * Main story first, then the oldest side task — one line, never a list. A
   * HUD that shows four objectives is a HUD nobody reads, and the journal is
   * where the full picture lives.
   */
  private syncObjective(): void {
    const active = this.quests.activeQuests();
    const lead = active.find((q) => q.kind === 'main') ?? active[0];
    if (!lead) {
      if (this.lastObjective !== null) {
        this.lastObjective = null;
        this.host.setObjective(null);
      }
      return;
    }

    const next = lead.objectives.find((o) => !o.complete && !o.optional);
    const text = next
      ? next.target > 1
        ? `${t(next.labelKey)}  ${Math.floor(next.done)}/${next.target}`
        : t(next.labelKey)
      : t(lead.stageTitleKey);

    if (text !== this.lastObjective) {
      this.lastObjective = text;
      this.host.setObjective(text);
    }
  }

  // -- reporting -----------------------------------------------------------

  /** Everything the world does, offered to every active quest. */
  report(what: ProgressReport, amount = 1): number {
    return this.quests.reportAll(what, amount);
  }

  /**
   * Distance covered in a vehicle.
   *
   * Accumulated and flushed in whole metres, because a `drive` objective for
   * 1,200 m fed 0.3 m at a time would round to nothing on every single frame.
   */
  reportDriving(metres: number, vehicleKind: string): void {
    if (!Number.isFinite(metres) || metres <= 0) return;
    this.drivenMetres += metres;
    if (this.drivenMetres < 1) return;

    const whole = Math.floor(this.drivenMetres);
    this.drivenMetres -= whole;

    for (const view of this.quests.activeQuests()) {
      for (const o of view.objectives) {
        if (o.kind !== 'drive' || o.complete) continue;
        const def = questDef(view.id);
        const stage = def?.stages.find((s) => s.id === view.stageId);
        const objective = stage?.objectives.find((x) => x.id === o.id);
        if (objective?.vehicleKind && objective.vehicleKind !== vehicleKind) continue;
        this.quests.report(view.id, { objectiveId: o.id }, whole);
      }
    }
  }

  // -- talking -------------------------------------------------------------

  /**
   * Does the story want this conversation?
   *
   * A resident who is part of the current stage gets the authored tree; anyone
   * else gets Phase 6's small talk, which `Game` still owns. Returning null is
   * how the director says "not mine".
   */
  dialogueFor(npcId: string): DialogueTurn | null {
    for (const view of this.quests.activeQuests()) {
      const def = questDef(view.id);
      const stage = def?.stages.find((s) => s.id === view.stageId);
      if (!stage?.dialogueId) continue;

      const wantsThisPerson = stage.objectives.some(
        (o) => o.kind === 'talk' && o.npcId === npcId,
      );
      if (!wantsThisPerson) continue;

      const tree = dialogueTree(stage.dialogueId);
      if (!tree) continue;

      return this.dialogue.start(tree, npcId, {
        relationship: this.host.relationship(npcId),
        playerAge: this.host.age,
      });
    }
    return null;
  }

  /** Take a dialogue choice and apply everything it produced. */
  choose(index: number): DialogueTurn | null {
    const npcId = this.dialogue.npcId;
    const result = this.dialogue.choose(index);
    if (!result) return null;

    if (result.outcome.relationship) {
      this.host.adjustRelationship(npcId, result.outcome.relationship);
    }
    for (const c of result.outcome.consequences) this.quests.applyConsequence(c);

    if (result.outcome.ended) {
      // The conversation itself is the `talk` objective.
      this.report({ kind: 'talk', npcId });
    }
    return result.turn;
  }

  // -- the ending ----------------------------------------------------------

  private settleEnding(): void {
    const family = familyFromFlags((f) => this.state.has(f));
    const ending = resolveEnding(family, (c) => this.quests.test(c));
    this.state.setEnding(ending.id);
    this.state.recordReel({
      kind: 'ending',
      age: Math.round(this.host.age * 10) / 10,
      textKey: ending.titleKey,
    });
    this.host.toast(t(ending.titleKey), t(ending.bodyKey));
  }

  /** A birthday card, and the reel line that remembers it. */
  birthday(age: number, unlocked: readonly string[]): ReturnType<typeof postcardFor> {
    this.state.recordReel({ kind: 'birthday', age, textKey: 'reel.birthday', detail: String(age) });
    return postcardFor(age, unlocked);
  }

  reel(facts: ReelFacts): ReelModel {
    return buildReel(this.state, facts);
  }

  /** Journal contents: main story first, then side tasks. */
  journal(): Array<{ id: string; title: string; stage: string; objectives: string[]; kind: string }> {
    return this.quests.activeQuests().map((q) => ({
      id: q.id,
      title: t(q.titleKey),
      stage: t(q.stageTitleKey),
      kind: q.kind,
      objectives: q.objectives
        .filter((o) => !o.complete)
        .map((o) => (o.target > 1 ? `${t(o.labelKey)} ${Math.floor(o.done)}/${o.target}` : t(o.labelKey))),
    }));
  }

  /**
   * Who would answer, for the reel's people section.
   *
   * Takes `RelationshipStore.toJSON()`'s shape rather than the live store, so
   * the director never holds a reference to something that is rebuilt on every
   * zone change. Closeness averages the three warm axes and ignores `fear` and
   * `respect` — being feared is not being known.
   */
  friends(
    relationships: readonly (Pick<RelationshipAxes, 'trust' | 'affection' | 'familiarity'> & {
      npcId: string;
    })[],
  ): ReelFacts['friends'] {
    const out: Array<{ name: string; closeness: number }> = [];
    for (const r of relationships) {
      const closeness = (r.trust + r.affection + r.familiarity) / 3;
      if (closeness <= 0.05) continue;
      out.push({ name: this.host.npcName(r.npcId), closeness });
    }
    return out;
  }
}
