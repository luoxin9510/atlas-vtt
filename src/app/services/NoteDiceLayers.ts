import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { App } from 'obsidian';
import { AtlasUIContext } from '../react/root/AtlasUIContext';
import { DiceRollDisplay, type DiceRollSubscription } from '../react/components/dice/DiceRollDisplay';
import type { OffMapRolled, OffMapRoller } from './offMapRoller';

type Shown = (rolled: OffMapRolled) => void;

/** The rolls a layer holds for a display that has not listened yet, as many as the roller keeps. */
const WAITING_LENGTH = 20;

/** The dice layer of one window: its host, the display mounted in it, and the rolls the display has not listened for yet. */
class WindowLayer {
  private readonly root: Root;
  private readonly listeners = new Set<Shown>();
  /** Rolls made before the display listened: the display takes them when it mounts. */
  private readonly waiting: OffMapRolled[] = [];

  constructor(readonly host: HTMLElement, app: App) {
    this.root = createRoot(host);
    this.root.render(createElement(AtlasUIContext.Provider, { value: { app, view: null, pixiApp: null, renderer: null } },
      createElement(DiceRollDisplay, { container: host, subscribe: this.subscribe, cardSounds: true, dismissOnEscape: true })));
  }

  show(rolled: OffMapRolled): void {
    if (this.listeners.size > 0) {
      for (const listener of this.listeners) listener(rolled);
      return;
    }
    this.waiting.push(rolled);
    if (this.waiting.length > WAITING_LENGTH) this.waiting.shift();
  }

  destroy(): void {
    this.root.unmount();
    this.host.remove();
    this.listeners.clear();
  }

  private readonly subscribe: DiceRollSubscription = (onRoll) => {
    const listener: Shown = ({ result, muted, origin }) => onRoll(result, { muted, origin });
    this.listeners.add(listener);
    for (const rolled of this.waiting.splice(0)) listener(rolled);
    return () => { this.listeners.delete(listener); };
  };
}

/**
 * The dice of the rolls made with no map open, shown in the window they were made in: one host at
 * the bottom right of that window's workspace, made with its first roll (dice stages hold graphics
 * memory, and most windows never roll), holding the display maps use. A window sees only its own
 * rolls. A window that closes (`removeDocument`) or Atlas unloading (`dispose`) removes its hosts.
 */
export class NoteDiceLayers {
  private readonly layers = new Map<Document, WindowLayer>();
  private stopListening: (() => void) | undefined;

  constructor(private readonly app: App, private readonly roller: OffMapRoller) {}

  /** Starts showing the roller's rolls. */
  start(): void {
    this.stopListening ??= this.roller.onRoll((rolled) => {
      if (!rolled.displayed) this.layerOf(rolled.doc).show(rolled);
    });
  }

  /** Removes the host of a window that closed; its next roll, if it opens again, makes a new one. */
  removeDocument(doc: Document): void {
    this.layers.get(doc)?.destroy();
    this.layers.delete(doc);
  }

  dispose(): void {
    this.stopListening?.();
    this.stopListening = undefined;
    for (const layer of this.layers.values()) layer.destroy();
    this.layers.clear();
  }

  /** The layer of `doc`'s window, else of the main one where that window has closed. */
  private layerOf(rollDoc: Document): WindowLayer {
    const doc = rollDoc.defaultView ? rollDoc : this.app.workspace?.containerEl?.ownerDocument ?? activeDocument;
    let layer = this.layers.get(doc);
    if (!layer) {
      layer = new WindowLayer(doc.body.createDiv({ cls: 'atlas-vtt-plugin atlas-note-dice-layer' }), this.app);
      this.layers.set(doc, layer);
    }
    return layer;
  }
}
