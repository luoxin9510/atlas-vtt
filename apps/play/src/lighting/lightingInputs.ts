import type { SharedLight, SharedLightingScene, SharedSight, SharedWall, SharedZone, SightToken } from '../../../../src/app/online/protocol/index.ts';
import type { MeasurementSettings } from '../../../../src/app/grid/measurementFormat';
import type { TokenEntity } from '../../../../src/app/types';
import type { GridState } from '../../../../src/app/types/gridTypes';
import type { LightEmission, LightSource, LightZone, SceneLighting } from '../../../../src/app/types/lightingTypes';
import type { WallSegment } from '../../../../src/app/types/wallTypes';
import type { SceneState } from '../../../../src/app/vision/sceneModel';
import type { MapBounds } from '../../../../src/app/vision/visibility';
import { sameValue } from './sameValue.ts';

/** Inverse of the GM's `sharedWall`: an open door is a door that is not closed, a closed one a door that is. */
function wallOf(shared: SharedWall, index: number): WallSegment {
  const [x1, y1, x2, y2] = shared.p;
  return {
    id: `wall-${index}`,
    kind: 'wall',
    type: shared.door === undefined ? 'solid' : 'door',
    p1: { x: x1, y: y1 },
    p2: { x: x2, y: y2 },
    ...(shared.door !== undefined && { closed: shared.door === 'closed' }),
    ...(shared.direction && { direction: shared.direction }),
    ...(shared.blocks && { blocks: shared.blocks }),
    ...(shared.limited === true && { limited: true }),
  };
}

function zoneOf(shared: SharedZone, index: number): LightZone {
  const polygon: LightZone['polygon'] = [];
  for (let i = 0; i + 1 < shared.polygon.length; i += 2) polygon.push({ x: shared.polygon[i]!, y: shared.polygon[i + 1]! });
  return { id: `zone-${index}`, kind: 'light-zone', polygon, ambient: shared.ambient, ...(shared.colour && { ambientColor: shared.colour }) };
}

function lightOf(shared: SharedLight): LightSource {
  return {
    id: shared.id, kind: 'light', x: shared.x, y: shared.y, emission: shared.emission as unknown as LightEmission,
    ...(shared.rotation !== undefined && { rotation: shared.rotation }),
    ...(shared.activeBelowAmbient !== undefined && { activeBelowAmbient: shared.activeBelowAmbient }),
  };
}

/** A token as sight reads it: the effects are its conditions, and with every vision token hidden none gives sight. */
function tokenOf(shared: SightToken, blind: boolean): TokenEntity {
  return {
    id: shared.id, kind: 'token', imagePath: '', x: shared.x, y: shared.y, size: shared.size,
    ...(shared.rotation !== undefined && { rotation: shared.rotation }),
    ...(shared.vision && { vision: { enabled: true, ...(shared.vision.angle !== undefined && { angle: shared.vision.angle }) } }),
    ...(shared.light && { light: shared.light as unknown as LightEmission }),
    ...(shared.effects && shared.effects.length > 0 && { conditions: [...shared.effects] }),
    ...(blind && shared.vision && { isHidden: true }),
  };
}

interface Entry<Source, Value> {
  readonly source: Source;
  readonly blind?: boolean;
  readonly value: Value;
}

/**
 * Turns the GM's shared lighting messages into the scene state the shared lighting engine reads
 * (the inverse of `gm/sceneInputs.ts`). `SceneModelBuilder` compares records by reference, so
 * every record, and every wall, light, zone and token in it, is the object it was last time while
 * its input is equal by value.
 */
export class LightingInputs {
  private lightingMessage: SharedLightingScene | null = null;
  private walls: Record<string, WallSegment> = {};
  private zones: Record<string, LightZone> = {};
  private grid: GridState = { enabled: true, size: 70, offsetX: 0, offsetY: 0, opacity: 1 };
  private measure: MeasurementSettings = { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 90 };
  private lightingOptions: SceneLighting = { enabled: true, ambient: 0 };
  private lights = new Map<string, Entry<SharedLight, LightSource>>();
  private lightRecord: Record<string, LightSource> = {};
  private tokens = new Map<string, Entry<SightToken, TokenEntity>>();
  private tokenRecord: Record<string, TokenEntity> = {};
  private held: Record<string, { x: number; y: number }> = {};

  /** The scene's scale as `SceneModelBuilder` asks for it; the same object while it does not change. */
  measurement(): MeasurementSettings {
    return this.measure;
  }

  update(lighting: SharedLightingScene, sight: SharedSight, _map: MapBounds): SceneState {
    this.readLighting(lighting);
    this.readLights(sight.lights);
    this.readTokens(sight.tokens, sight.blind === true);
    this.readHeld(sight.held);
    if (!sameValue(this.lightingOptions, sight.lighting)) this.lightingOptions = { ...sight.lighting } as unknown as SceneLighting;
    return {
      objects: { tokens: this.tokenRecord, walls: this.walls, lights: this.lightRecord, lightZones: this.zones },
      lighting: this.lightingOptions,
      grid: this.grid,
      heldTokens: this.held,
    };
  }

  private readLighting(lighting: SharedLightingScene): void {
    const previous = this.lightingMessage;
    if (previous === lighting) return;
    this.lightingMessage = lighting;
    if (!previous || !sameValue(previous.walls, lighting.walls)) this.walls = Object.fromEntries(lighting.walls.map((wall, index) => [`wall-${index}`, wallOf(wall, index)]));
    if (!previous || !sameValue(previous.zones, lighting.zones)) this.zones = Object.fromEntries(lighting.zones.map((zone, index) => [`zone-${index}`, zoneOf(zone, index)]));
    if (this.grid.size !== lighting.cellSize) this.grid = { ...this.grid, size: lighting.cellSize };
    if (this.measure.unitDistance !== lighting.unitDistance) this.measure = { ...this.measure, unitDistance: lighting.unitDistance };
  }

  private readLights(shared: readonly SharedLight[]): void {
    const next = new Map<string, Entry<SharedLight, LightSource>>();
    for (const light of shared) {
      const before = this.lights.get(light.id);
      next.set(light.id, before && sameValue(before.source, light) ? before : { source: light, value: lightOf(light) });
    }
    if (this.sameEntries(this.lights, next)) return;
    this.lights = next;
    this.lightRecord = Object.fromEntries([...next].map(([id, entry]) => [id, entry.value]));
  }

  private readTokens(shared: readonly SightToken[], blind: boolean): void {
    const next = new Map<string, Entry<SightToken, TokenEntity>>();
    for (const token of shared) {
      const before = this.tokens.get(token.id);
      next.set(token.id, before && before.blind === blind && sameValue(before.source, token) ? before : { source: token, blind, value: tokenOf(token, blind) });
    }
    if (this.sameEntries(this.tokens, next)) return;
    this.tokens = next;
    this.tokenRecord = Object.fromEntries([...next].map(([id, entry]) => [id, entry.value]));
  }

  private readHeld(shared: SharedSight['held']): void {
    const next = Object.fromEntries(shared.map(({ id, x, y }) => [id, { x, y }]));
    if (!sameValue(this.held, next)) this.held = next;
  }

  /** Whether `next` holds the very entries (and in the same order) `before` did. */
  private sameEntries<Source, Value>(before: ReadonlyMap<string, Entry<Source, Value>>, next: ReadonlyMap<string, Entry<Source, Value>>): boolean {
    if (before.size !== next.size) return false;
    const a = [...before];
    return [...next].every(([id, entry], index) => a[index]![0] === id && a[index]![1] === entry);
  }
}
