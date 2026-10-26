# Foundry VTT architecture: what to borrow for self-hosted Atlas (research report)

Date: 2026-10-26. Sources: official Foundry API docs (https://foundryvtt.com/api/, currently rendering v14 pages) and
knowledge-base articles (https://foundryvtt.com/article/...). Items marked [COMMUNITY] come from non-official pages,
[NOT DOCUMENTED] means the official page was fetched and does not say. Our spec: M1-M2 relay+host, M3 player scene/dice/log,
M4 lighting/drag/asset cache, M5 shared notes (G1-G8 in docs/superpowers/specs/2026-10-26-self-hosted-online-design.md).
Caveat: pages were summarized via a fetch tool, so exact field lists on very long pages (Scene, TokenDocument) are partial.

---------------------------------------------------------------------------------------------------
## 1. Document model and data schema

How Foundry does it
- Document extends DataModel; documents are "persisted to the database and referenced by `_id`".
  https://foundryvtt.com/api/classes/foundry.abstract.Document.html
- Schema: `static defineSchema()` returns typed fields (StringField, NumberField, SchemaField, EmbeddedCollectionField,
  DocumentIdField, DocumentFlagsField, DocumentOwnershipField, DocumentStatsField, TypeDataField, FilePathField, HTMLField),
  cached once and shared by all instances. https://foundryvtt.com/api/classes/foundry.abstract.DataModel.html
- Every document carries the same envelope: `_id`, `name`, `flags`, `ownership`, `sort`, `_stats`, plus a type-specific
  `system`. Example JournalEntryPage fields: _id, _stats, category, flags, image, name, ownership, sort, src, system,
  text, title, type, video. https://foundryvtt.com/api/classes/foundry.documents.JournalEntryPage.html
- Embedded documents: a parent owns child collections (`getEmbeddedCollection`, `createEmbeddedDocuments`,
  `updateEmbeddedDocuments`, `deleteEmbeddedDocuments`). Scene embeds notes, drawings, lights, regions, tokens, tiles;
  JournalEntry embeds `pages`. UUID pattern is hierarchical: `JournalEntry.<id>.JournalEntryPage.<id>`.
  Embedded documents defer to the parent's ownership. Sources: Document page above, JournalEntryPage page above,
  https://foundryvtt.com/api/classes/foundry.documents.Scene.html
- Local vs persisted data: `_source` (sealed raw data), derived instance data, `toObject(source=true)`, `toJSON()` (source),
  `updateSource(changes)` validates, applies to `_source`, and RETURNS THE DIFF; dry run is possible. DataModel page above.
- Validation: `validate()`, `validateJoint()`, `invalid`, `validationFailures {fields, joint}`; invalid documents are kept
  rather than dropped (strict mode throws). DataModel page above.
- Schema versioning / migration: there is NO schema-version integer on the model. The pathway is `static migrateData(source)`
  (and `migrateDataSafe` = try/catch wrapper), run when source data is first loaded (`_initializeSource`) and on update
  deltas before they are applied; `shimData` keeps old accessors alive for old code. DataModel page above and
  https://foundryvtt.com/article/system-data-models/ (example: legacy code "bmr" -> "boomerang"; override calls super).
- `_stats` (DocumentStatsField) is server-managed metadata ("managedFields are ignored if sent in create/update");
  it carries version info for migration decisions (core/system version fields are not listed on the official page; they
  are known from Foundry's data but NOT DOCUMENTED there).
  https://foundryvtt.com/api/classes/foundry.data.fields.DocumentStatsField.html
- IDs: `_id` is a DocumentIdField (client-generated random string); `uuid` is a path of `Type.id` segments.
  Compendium docs have `pack`. (id generation details: NOT DOCUMENTED on fetched pages.)
- Flags: `getFlag(scope, key)`, `setFlag(scope, key, value)`, `unsetFlag(scope, key)` store arbitrary data in
  `flags.<scope>.<key>`; setting null deletes; recommended scopes are "core", the module id, or "world".
  https://foundryvtt.com/api/classes/foundry.abstract.Document.html
- Subtypes: system/module declare `documentTypes` in the manifest; each subtype gets a TypeDataModel registered at init
  (`CONFIG.Actor.dataModels.character = ...`); `htmlFields` (must be sanitized) and `filePathFields` (so the server can
  extract base64 into files) are declared per subtype so the server does not discard or trust them blindly.
  https://foundryvtt.com/article/system-data-models/ ; v11+ modules may also add subtypes with data in `system`
  https://foundryvtt.com/article/module-development/

How it could inform us
- Our wire protocol is `v:1` JSON frames from the GM client (src/app/online/protocol). Foundry's lesson: separate
  (a) an envelope every entity shares (`id`, `name`, `flags`, `ownership`, `sort`) from (b) a typed `system` payload and
  (c) an open `flags.<scope>` bag for extensions. We can add `flags` to scene/token/note payloads so forks/plugins add data
  without protocol bumps; unknown scopes are passed through untouched by the relay (it already never reads game bodies).
- `migrateData` on load + `updateSource` returning a diff: a cheap pattern for the player app so it tolerates older
  messages without a hard `v` bump. Prefer `v` + per-message additive fields + client-side migrate function.
- `_stats.modifiedTime/lastModifiedBy`: use a monotonically increasing `rev` or modifiedTime per entity on the GM side
  so players can drop stale or reordered updates (see section 3).
- Declaring `htmlFields` / `filePathFields` per payload type is a good model for our leak tests: a schema marks which
  string fields hold HTML/Markdown (sanitize) and which hold asset references (rewrite to signed ticket / hash).

---------------------------------------------------------------------------------------------------
## 2. Ownership and permission model

How Foundry does it
- Ownership levels (CONST.DOCUMENT_OWNERSHIP_LEVELS): INHERIT = -1, NONE = 0, LIMITED = 1, OBSERVER = 2, OWNER = 3;
  "Higher levels grant more permissions". https://foundryvtt.com/api/variables/CONST.DOCUMENT_OWNERSHIP_LEVELS.html
- Storage: `ownership` field is a DocumentOwnershipField = ObjectField mapping User IDs to levels, with `default` key
  (initial default 0). https://foundryvtt.com/api/classes/foundry.data.fields.DocumentOwnershipField.html
  (The official field page does not spell out the `{default, <userId>}` shape; widely used and visible in exports - treat
  shape as [COMMUNITY]-level knowledge.) Embedded docs inherit the parent's ownership.
- Checks: `testUserPermission(user, level, {exact})` (level-or-greater), `getUserLevel(user)` (explicit level only; ignores
  role, so a GM may report NONE), `canUserModify(user, action, data)`, static `canUserCreate(user)`. Compendium content
  uses role-based ownership (manifest `ownership: {PLAYER, TRUSTED, ASSISTANT}` -> OWNER/OBSERVER/NONE).
  https://foundryvtt.com/api/classes/foundry.abstract.Document.html ; https://foundryvtt.com/article/module-development/
- Meaning in the KB: None "usually hides the document", Limited "basic interaction with limited visibility of contents",
  Observer "can view but not change", Owner "can view and edit". "Game Masters always own every document. By default,
  documents are visible only to Game Masters." Only GMs delete owned docs unless a special permission is granted.
  https://foundryvtt.com/article/users/
- Roles (CONST.USER_ROLES): NONE 0, PLAYER 1, TRUSTED 2, ASSISTANT 3, GAMEMASTER 4.
  https://foundryvtt.com/api/variables/CONST.USER_ROLES.html . NONE = banned; Trusted = drawings, measured templates,
  optional uploads; Assistant = most GM controls, no world admin; every role set is per world (no global accounts).
  https://foundryvtt.com/article/users/ ; search summary of same article.
- `User.isGM` is true for GAMEMASTER **or** ASSISTANT; `hasRole(role, exact)`, `can(action)`, `isTrusted`.
  https://foundryvtt.com/api/classes/foundry.documents.User.html
- CONST.USER_PERMISSIONS = 24 role-gated actions with a default minimum role (1=Player, 2=Trusted, 3=Assistant):
  Role 1: MACRO_SCRIPT, MESSAGE_WHISPER, PING_CANVAS, QUERY_USER, REGION_CREATE, SHOW_CURSOR, SHOW_RULER, WALL_DOORS.
  Role 2: BROADCAST_AUDIO, BROADCAST_VIDEO, DRAWING_CREATE, FILES_BROWSE, JOURNAL_CREATE, MANUAL_ROLLS, NOTE_CREATE,
  TOKEN_CONFIGURE. Role 3: ACTOR_CREATE, CARDS_CREATE, FILES_UPLOAD, ITEM_CREATE, PLAYLIST_CREATE, SETTINGS_MODIFY,
  TOKEN_CREATE, TOKEN_DELETE. https://foundryvtt.com/api/variables/CONST.USER_PERMISSIONS.html
  GM can reconfigure which role gets each permission ("Configure Permissions").
- How LIMITED shows partial info (journals): Limited users see the map pin and image but NOT the sidebar entry; Observer
  sees the sidebar entry and can toggle image/text; Owner edits. https://foundryvtt.com/article/journal/
  For tokens, `displayName` / `displayBars` modes (CONST.TOKEN_DISPLAY_MODES) and a SECRET disposition
  (`TokenDocument.isSecret`) hide name/bars from non-owners. https://foundryvtt.com/api/classes/foundry.documents.TokenDocument.html
  (the TOKEN_DISPLAY_MODES values themselves are listed only as a name on https://foundryvtt.com/api/modules/CONST.html)
- Combat visibility: hidden combatants removed from players' initiative list but still take turns; defeated shown faded.
  https://foundryvtt.com/article/combat/

How it could inform us
- Our model has no accounts, so three effective roles suffice: GM (laptop), seat-owner player, observer/spectator.
  Borrow the 4-step ownership ladder per entity with a `default` + per-seat map: NONE (not sent), LIMITED (sent redacted:
  token marker + no name; note title but no body), OBSERVER (read), OWNER (may request moves/rolls). This maps cleanly to
  G4 (drag own tokens = OWNER check on GM side), G6 (shared notes) and the anti-goals list (hidden token/note leaks).
- Make "redact by level" a pure function `project(entity, level) -> payload` on the GM client, covered by the existing
  `*Leak` test families; one function per entity type is easier to audit than ad-hoc filtering.
- Permission table pattern (USER_PERMISSIONS with min role): define a small table of player actions with a default
  (PING, SHOW_CURSOR, SHOW_RULER, WHISPER, MANUAL_ROLLS) the GM can toggle per table or per seat. Cheap, GM-configurable.
- Note Foundry's `isGM` includes ASSISTANT: if "co-GM" ever matters, treat it as a role flag, not a separate protocol.

---------------------------------------------------------------------------------------------------
## 3. Real-time sync and authority

How Foundry does it
- Transport: Socket.io; `game.socket` is the open connection (read-only reference); `Game.connect()` opens it;
  `Game.getData(socket, view)` pulls world data on join. https://foundryvtt.com/api/classes/foundry.Game.html
- Authority = the SERVER. All CRUD goes through one pipeline: client calls `Document.create/update/delete(...)`
  (or static `createDocuments/updateDocuments/deleteDocuments`, embedded variants), which becomes a database operation sent
  over the socket; the server applies it, persists, and broadcasts to other clients. Foundry's official docs describe:
  - Per-document pre-hooks (`_preCreate/_preUpdate/_preDelete`) run ONLY on the requesting client; return false cancels.
  - Post-hooks (`_onCreate/_onUpdate/_onDelete`) run on ALL connected clients.
  - Batch hooks `_pre*Operation` / `_on*Operation` run after the per-document ones; the pre-batch ones are the final check
    before the database call. https://foundryvtt.com/api/classes/foundry.abstract.Document.html
  - Permission check surface: `canUserModify(user, action, data)` and ownership levels (the server enforces permissions;
    the explicit "server rejects with error" text is NOT DOCUMENTED on the fetched pages - that part is general Foundry
    knowledge).
- Operation shape (DatabaseUpdateOperation): `action: "update"`, `documentName`, `parent`/`parentUuid`, `pack`,
  `updates[]` (each with `_id`), `diff` ("each update is compared against current Document data, only differences are
  applied"), `recursive` (deep-merge vs replace), `render` (re-render dependent Applications), `broadcast` (send to others),
  `noHook`, `dryRun`, `modifiedTime`. https://foundryvtt.com/api/interfaces/foundry.abstract.types.DatabaseUpdateOperation.html
- Conflicts: last write wins at the server; `diff` makes updates field-granular and drops no-op writes; `modifiedTime` and
  `_stats` give ordering metadata. No CRDT / locking is documented. (inference from the above; not stated as a "conflict
  policy" on the official pages.)
- SocketInterface.dispatch(eventName, request) -> Promise<SocketResponse>: standardized request/response over the socket.
  https://foundryvtt.com/api/classes/foundry.helpers.SocketInterface.html (only `dispatch` is documented there.)
- Package sockets: manifest `"socket": true` makes the server relay `module.<id>` (or `system.<id>`) events between clients.
  https://foundryvtt.com/article/module-development/ ("the server handles a `module.{name}` event and relays data between
  connected clients"). [COMMUNITY] wiki/Discord: the emitting client does not receive its own broadcast, so run the handler
  locally too. https://foundryvtt.wiki/en/development/api/sockets (page body did not load in our fetch; claim from search
  snippet, unverified).
- socketlib [COMMUNITY]: RPC-style "run function on remote clients", and `executeAsGM` picks exactly one GM when several are
  connected. https://foundryvtt.com/packages/socketlib . This is the standard workaround for "player action needs GM
  authority" - exactly our architecture, where the GM is the only trusted executor.
- UI refresh: `render: true` on the operation + document hooks (`updateToken`, `renderChatMessage`...) drive redraws.
- Pause: `game.paused`, `togglePause(pause, {broadcast})` (broadcast requires GM) fires hook `pauseGame`.
  https://foundryvtt.com/api/classes/foundry.Game.html . While paused players cannot move tokens or manipulate doors.
  https://foundryvtt.com/article/player-orientation/
- Pre-checks on the requesting client only (`_preUpdate`) are for UX; real authority is server-side permission.

How it could inform us (important difference)
- Foundry: server authoritative + stores state. Ours: GM client authoritative, relay stateless. So we need "socketlib
  executeAsGM" as the DEFAULT, not the exception: players send INTENTS (`token.move`, `roll.request`, `chat.send`,
  `note.open`), the GM validates (ownership + pause + movement rules) and publishes results. Keep that framing in M3-M4.
- Borrow the operation envelope: `{action, entity, parent, updates:[{id, ...partial}], diff:true, rev}`. Partial-diff
  updates keep phone bandwidth small (G8, mainland mobile nets) and give one place for ownership projection.
- Borrow "pre-hooks run on requester, post-hooks run on all": client-side optimistic drag (OWNER player moves the sprite
  locally) with GM authoritative accept/refuse, rolling back on refusal - matches G4 text "GM's existing checks accept or
  refuse each move".
- Add `modifiedTime`/`rev` per entity and a snapshot-on-join message (Foundry's `getData` on connect) so reconnecting
  phones resync fully instead of replaying missed diffs; the relay can buffer nothing and still be correct.
- Pause flag: trivial, high-value feature (blocks player moves, GM-broadcast), one boolean in the scene state.

---------------------------------------------------------------------------------------------------
## 4. Hooks and extension API

How Foundry does it
- Hooks is a static event bus: `Hooks.on(hook, fn, {once})` returns a numeric id; `Hooks.once`; `Hooks.off(hook, fnOrId)`;
  `Hooks.call(hook, ...args)` runs listeners in registration order and STOPS when one returns `false`, returning
  whether all ran; `Hooks.callAll` ignores return values, all listeners run; `Hooks.events` read-only registry;
  `Hooks.onError(location, error, opts)` isolates and reports listener errors.
  https://foundryvtt.com/api/classes/foundry.helpers.Hooks.html
- Lifecycle: `init` (before documents), `setup`, `ready` (flag `game.ready`), `canvasInit` etc.
  https://foundryvtt.com/api/classes/foundry.Game.html . Hook articles at /article/hooks/ returned 404; names beyond what the
  API pages state (preCreate*/create*/preUpdate*/update*/render*) are from general Foundry knowledge and the Document
  lifecycle above (`_preCreate` returning false cancels).
- Module manifest `module.json`: required `id`, `title`, `description`, `version`; optional `compatibility`
  {minimum, verified, maximum}, `esmodules`, `scripts`, `styles`, `languages` [{lang,name,path}], `relationships`
  {systems, requires} (missing deps block enabling), `packs`, `socket`, `library`, `flags`... Modules register via
  `Hooks.on("init"/"ready")`. https://foundryvtt.com/article/module-development/
- Module API convention [COMMUNITY]: expose `game.modules.get(id).api = {...}` in `init`/`ready`. Not on the fetched
  official pages (NOT DOCUMENTED there).
- Extensible registries: `CONFIG.<Doc>.dataModels`, `CONFIG.Actor.trackableAttributes`, custom text enrichers
  (`_applyCustomEnrichers` / TextEditorEnricherConfig, see 5).

How it could inform us
- A tiny `Hooks` bus on the GM side (Obsidian plugin) with three semantics is enough: `on/once/off`, `call` (cancellable,
  e.g. `preMoveToken`, `preSharePage`, `preRoll` returning false = refuse) and `callAll` (notifications: `tokenMoved`,
  `diceRolled`, `sceneChanged`). Gate: `call` hooks only on the GM client, never on the player app, so a plugin cannot be
  loaded from a player's browser. Maps to Atlas move validation (G4) and dice (G5).
- Minimum plugin manifest: `id`, `version`, `compat {min,verified,max}` of protocol `v`, `requires`. Reject plugins whose
  `max` < current protocol.
- Provide `flags.<scope>` as the sole sanctioned extension data location (see 1) plus a registry of "message types a plugin
  may add" under namespace `plugin.<id>.*`, mirroring Foundry's `module.<id>` socket events relayed verbatim by the server.
  The relay should forward `plugin.*` frames only between GM and seats that were granted them and keep the per-frame size cap.

---------------------------------------------------------------------------------------------------
## 5. Journal entries and sharing

How Foundry does it
- JournalEntry (container) embeds JournalEntryPage documents; page `type` values: text, image, video, pdf (plus system
  subtypes). Text pages have a format (HTML; the schema field `text` holds content/markdown/format, subfields not verified on
  official page) - https://foundryvtt.com/article/journal/ and
  https://foundryvtt.com/api/classes/foundry.documents.JournalEntryPage.html (CONST lists `JOURNAL_ENTRY_PAGE_FORMATS`
  https://foundryvtt.com/api/modules/CONST.html). So Markdown pages are a first-class format in core.
- Page fields: name, type, text, image, video, src, title (heading level), sort, category, ownership (per-user map),
  flags, system. Per-page `ownership` exists in the schema; the KB article only documents entry-level "Configure
  Permission" (None default for non-creators, Limited, Observer, Owner).
- "Show Players": entry heading menu -> all players by default or selected players; in multipage view, right-click a page
  in the sidebar -> "Show Players" shares that page. API: `JournalEntry#show(force=false)` displays the entry to connected
  players "who have permission to observe the entry"; `force=true` shows to all regardless of permissions.
  https://foundryvtt.com/article/journal/ ; https://foundryvtt.com/api/classes/foundry.documents.JournalEntry.html
  (how the request reaches other clients is NOT DOCUMENTED on that page).
- Scene Notes: pin an entry/page on a Scene; click opens the page; `JournalEntry#sceneNote`, `panToNote()`. A Limited user
  sees the pin and image only. https://foundryvtt.com/article/journal/
- Secrets: a Secret block in a text page is visible to GM/owner only; GM "reveal" button makes it visible to players
  currently viewing. HTML: `<section class="secret" id="...">`; `TextEditor.enrichHTML(..., {secrets})` removes
  unrevealed secret blocks when `secrets` is false. The `<section class="secret">` markup itself is general Foundry
  knowledge; confirmed behaviour (secrets option) at
  https://foundryvtt.com/api/classes/foundry.applications.ux.TextEditor.html and the journal article above.
- Enrichers (TextEditor.enrichHTML options: `secrets, documents, links, embeds, rolls, custom, relativeTo, rollData`):
  `@UUID[uuid]{Label}` content links, `@Embed[uuid]{label}` document embeds, `[[2d12]]` immediate inline roll,
  `[[/roll 1d10]]` deferred roll button, `[[formula]]{label}`; invalid roll expressions are left unreplaced; compendium
  documents are batch "primed". https://foundryvtt.com/article/dice/ ; TextEditor API above.
- Link permission: "Clicking a link opens the document if the viewer has permission" (journal article). The content-link
  anchor itself is still rendered (broken-link styling / permission failure on click) - rendering behaviour beyond that
  sentence is NOT DOCUMENTED on the fetched pages.

How it could inform us (M5 / G6, anti-goal "titles or embeds of unshared notes")
- Model a share as {noteId, level, secretsRevealed:[ids]} and project server-side-of-GM (on the laptop): enrich the
  Markdown on the GM client and send the RESULT only. Foundry's `enrichHTML({secrets:false})` is exactly the right shape:
  strip first, then link-rewrite, then send. Never send raw Markdown with a "hide this" flag.
- Secret blocks in Markdown: use an Obsidian-native syntax (callout `> [!secret]` or a fenced `secret` block), plus a
  per-block stable id so "reveal" can be a tiny `{noteId, blockId}` message, like Foundry's reveal.
- Links between shared notes: render links to unshared notes as plain text (not as a dead link) - satisfies the anti-goal
  that titles/links of unshared notes never reach players. Foundry shows the label; we should show only the author-written
  alias, never the target title.
- "Show Players" as a push action (GM pushes a page to all/selected seats) plus passive "pinned on scene" (Limited/Observer).
  Two levels are enough for MVP: shared (OBSERVER) and pinned-preview (LIMITED = title/image only).
- Inline roll syntax `[[/r 1d20]]` in notes -> deferred roll button that sends a `roll.request` intent; nice M5 stretch.

---------------------------------------------------------------------------------------------------
## 6. Scenes and canvas

How Foundry does it
- Grid types: Gridless, Square (default), and four hex variants (flat-topped columns / pointy-topped rows, odd or even
  offset); size in pixels per square (min 50, default 100); Grid Scale/units is a free-text label (feet, miles).
  https://foundryvtt.com/article/scenes/ ; constants GRID_TYPES, GRID_DIAGONALS, GRID_SNAPPING_MODES, GRID_MIN_SIZE
  https://foundryvtt.com/api/modules/CONST.html
- Scene document sub-schemas: `grid`, `fog`, `environment`, `initial`, `navigation`, `navName`, `navOrder`, `active`,
  `playlist`, embedded `notes, drawings, lights, regions`. https://foundryvtt.com/api/classes/foundry.documents.Scene.html
  (grid/fog/environment subfields not visible on the fetched part.)
- Active vs viewed: `scene.activate({pullUsers})` makes it the scene for everyone and moves all users; `scene.view()` loads
  it for you only; `pullUsers(users)` moves specific users; `User.viewedScene` records who is on what. Navigation bar =
  bookmarks (Toggle Navigation, Navigation Name; GM-only scenes hidden from players). `Preload` asks all clients to
  background-load a scene's image/video. https://foundryvtt.com/article/scenes/ ; User page above.
- Token Vision: when enabled, players can see a scene only if they own a vision-enabled token in it. Global Illumination +
  threshold; Initial view = camera start (users with a token start on their token).
  https://foundryvtt.com/article/scenes/
- Lighting/vision: walls block light and sight; "Provides Vision" lights; darkness sources; darkness level with
  transition-to-daylight/darkness synced to all connected users; lights can activate in a darkness range.
  https://foundryvtt.com/article/lighting/ (summarized; fetch of /article/vision/ was 404)
- Fog exploration: per scene option; when enabled explored areas are tracked PER USER and persisted. Document
  FogExploration {scene, user, level, explored (image/base64 -> texture via getTexture), positions, timestamp},
  loaded via `FogExploration.load({scene, user})`; "Reset Fog of War" clears for everyone including offline users.
  https://foundryvtt.com/api/classes/foundry.documents.FogExploration.html ; lighting article above.
  Canvas side: `canvas.fog` (FogManager), `canvas.visibility` fog overlay (`visibilityOptions.persistentVision`).
  https://foundryvtt.com/api/classes/foundry.canvas.Canvas.html
- Ping: `canvas.ping(origin, options)` shows locally and on other clients; ALT = ALERT ping; GM+SHIFT = PULL ping (pulls
  everyone's view); otherwise PULSE. Permission PING_CANVAS (Player by default). Canvas page above;
  https://foundryvtt.com/api/variables/CONST.USER_PERMISSIONS.html
- Ruler: Ctrl(Cmd)+drag from an owned token shows path/distance, click adds waypoints, Space moves the token; walls block
  the ruler; cursor and ruler use the player color; SHOW_RULER / SHOW_CURSOR permissions share them with others.
  https://foundryvtt.com/article/player-orientation/ ; TokenLayer notes planned-movement broadcast
  (`_updatePlannedMovements`). https://foundryvtt.com/api/classes/foundry.canvas.layers.TokenLayer.html
- Layers: `canvas.layers`, `getCollectionLayer(name)`, `getLayerByEmbeddedName` (tokens, tiles, drawings, notes, walls,
  lighting, sight); drawings need DRAWING_CREATE (Trusted). Canvas page above.
- Token: x, y, elevation, width, height, shape, movement/`movementHistory`, `isOwner`, `isSecret`, `isLinked`. Hidden flag
  and `sight`/`vision` fields exist but were not visible in the fetched page portion [NOT VERIFIED].
  https://foundryvtt.com/api/classes/foundry.documents.TokenDocument.html
- Pause: players cannot move tokens/doors while paused (player-orientation article).

How it could inform us
- Fog persistence per player = our `explored` messages: store one explored bitmap/polygon set per (scene, seat) on the GM
  vault side (as Foundry's FogExploration does server-side), push it on join. Also copy the GM "reset fog" action.
- Active vs view split: let the GM "present" a scene (activate: pull all seats) while keeping per-seat `viewedScene`
  for later (players looking at a pinned map). Matches spec "presented scene" in G3a.
- Token Vision rule: player sees a scene only with an owned vision token -> gives a natural fail-closed rule that fits our
  "lit scene shows placeholder" decision (spec G3a/G3b).
- Pings: tiny message `{x,y,type,color,scene}` with a GM-toggleable permission; cheap, phone-friendly, big UX value. PULL
  ping (GM recenter everyone) is the best way to coordinate on a phone screen.
- Planned-movement/ruler: broadcast only when SHOW_RULER; on phones, show distance in grid units from `grid.distance+units`.
- Preload message: ask players to prefetch next scene assets (ties to G8 signed-ticket asset cache).
- Grid: keep to square + hex types and a free-text unit label; borrow `GRID_DIAGONALS` naming if movement rules extend.

---------------------------------------------------------------------------------------------------
## 7. Combat tracker, dice, chat

How Foundry does it
- Encounter tied to the scene it was created on; `Link Combat` to track across scenes. Combatants added from tokens;
  initiative per combatant; GM/Assistant: Begin Combat, Next/Previous Turn/Round, End Combat (deleting is not undoable);
  players roll their own initiative and may end their own turn; NPC turns only by GM. Hidden combatants invisible to
  players but still take turns; defeated shown faded, optional Skip Defeated; players see order, current/next actor, own
  initiative. https://foundryvtt.com/article/combat/
- Roll syntax: `/r` or `/roll`, `NdM`, `+ - * /`, parentheses, `#` label, `[flavor]` per term; inline `[[2d12]]`,
  `[[/roll 1d10]]`, `[[f]]{label}`. https://foundryvtt.com/article/dice/
- Roll modes (chat dropdown + commands): Public (`/publicroll`,`/pr`), GM Roll (`/gmroll`,`/gmr`; roller+GMs), Blind Roll
  (`/blindroll`,`/broll`,`/br`; GMs only, roller does not see), Self Roll (`/selfroll`,`/sr`). GM can "Reveal to Everyone"
  / "Make Private" via context menu. https://foundryvtt.com/article/dice/
- API: `new Roll(formula, data, options)`, `evaluate()` (async; `allowInteractive`, `maximize`, `minimize`), `total`,
  `terms` (RollTerm[]), `toMessage()`, `toJSON()/fromData()/fromJSON()`, `Roll.validate()`, `Roll.parse()`, `@attr`
  substitution from `data`. https://foundryvtt.com/api/classes/foundry.dice.Roll.html (serialized field list and roll hooks
  NOT DOCUMENTED there; Dice So Nice is a community module that listens to the message/roll hooks - [COMMUNITY], no
  official page fetched.)
- ChatMessage fields: `style` (number, CONST.CHAT_MESSAGE_STYLES), `author`, `speaker`, `whisper[]` (user ids), `blind`
  (hide roll result), `rolls[]` (JSON roll data), `flavor`, `content`, `sound`, `timestamp`, `flags`, `system`.
  Getters `visible`, `isContentVisible` (a roll message can be visible while its content is hidden), `isRoll`,
  `isAuthor`, `alias`. `ChatMessage.applyMode(data, mode)` sets visibility: public = no whisper/not blind; self = whisper
  to me; gm = whisper to GMs; blind = whisper to GMs + `blind:true`.
  https://foundryvtt.com/api/classes/foundry.documents.ChatMessage.html
- Chat types: IC `/ic`, OOC `/ooc`, emote `/em` `/me`, whisper `/w [a,b]` with special targets `gm` and `players`; GMs
  cannot read whispers they are not addressed in; speaker from selected token; chat bubbles above token (+ pan to speaker).
  Whisper requires MESSAGE_WHISPER. https://foundryvtt.com/article/chat/ ; MANUAL_ROLLS permission governs manual dice entry.

How it could inform us (G5, M3)
- Chat message model: {id, author, speaker, text, rolls:[{formula, terms, total}], whisper:[seatIds], blind, ts, flags}.
  The GM computes recipient set from `whisper`/`blind` and sends each seat only messages it may see; `blind` rolls: the
  roller gets a stub ("rolled blind") and no result. This exactly matches GM-centred visibility already in Atlas.
- Four roll modes with the same names (public / gm / blind / self) - familiar to Foundry users, tiny to implement; also
  "reveal" action = GM re-sends the message with a different projection.
- Roll JSON: serialize the evaluated roll (formula + per-term results) rather than only the total, so phones can
  render a dice breakdown; the GM client is the only RNG (anti-cheat, avoids players choosing results). Keep `MANUAL_ROLLS`
  off for players.
- Initiative: send only a projection: visible combatants (hidden ones omitted), current/next, own initiative; players may
  `endTurn` intent only for combatants they own. Fits G5 "see the initiative order".
- Chat bubble / speaker: optional; "speaker = owned token" is a nice default for phone players who have one character.

---------------------------------------------------------------------------------------------------
## 8. Users, players, assets, audio

How Foundry does it
- User document fields: name, role, character (default actor), color, pronouns, avatar, hotbar, permissions, flags,
  password/passwordSalt (+ `_id`, `_stats`); runtime: `active` (logged in), `viewedScene`, `targets`, `lastActivityTime`.
  https://foundryvtt.com/api/classes/foundry.documents.User.html
- User Configuration (right-click name in player list): avatar, color (random by default; colors cursor, ruler,
  drawings), default Character; players edit only own; GM/Assistant edit any.
  https://foundryvtt.com/article/users/ . Player list bottom-left shows accounts with colors; collapsed shows only online
  players. https://foundryvtt.com/article/player-orientation/
- No cross-world accounts; invite link + per-user password/access key. (accounts model NOT in fetched pages beyond the
  article statement "each World maintains its own player list".) https://foundryvtt.com/article/users/
- Assets: FilePicker with sources `data` | `public` | `s3` (each with target/bucket), `FilePicker.upload(source, path,
  file, body, options)` POST, `canUpload`, `canCreateFolder`, `browse(source, target, {extensions, wildcard, bucket})`,
  type filters (e.g. image, audio). Permissions FILES_BROWSE (Trusted) / FILES_UPLOAD (Assistant by default).
  https://foundryvtt.com/api/classes/foundry.applications.apps.FilePicker.html ;
  https://foundryvtt.com/api/variables/CONST.USER_PERMISSIONS.html . System fields `filePathFields` let the server extract
  base64 into files. Image optimization: NOT DOCUMENTED on the FilePicker page. (Knowledge-base file-upload article 404.)
- Audio: Playlist = named container of sounds; modes Sequential / Shuffle / Simultaneous / Soundboard-only; GM/Assistant
  manage; playing state is shared (volume change of a playing track affects all); each player's global volume sliders
  (Playlists, Ambient, Interface) are client-local; players can see the name of a playing playlist so avoid spoilers;
  sound source = file or direct URL; preloading helps. https://foundryvtt.com/article/playlists/ . Permissions
  BROADCAST_AUDIO/VIDEO (Trusted) for A/V chat.

How it could inform us
- Seat model: {seatId, name, color, avatar?, characterTokenId, online, lastSeen}. Presence ("online" dot) is a first-class
  field; Foundry's `active` + `lastActivityTime` -> relay already knows connection state; GM client publishes presence in
  the player list (G2/G5). Player-chosen color propagates to ping, ruler, cursor and chat name (consistency win).
- Per-world user list with a "default character" -> a seat has `defaultToken`, which selects speaker and camera start.
- Assets: our hash-addressed, signed-ticket cache (6.7) is stricter than Foundry's path-based FilePicker; borrow only the
  `extensions`/type filter and the "who may upload" permission; for the MVP players never upload (keep FILES_UPLOAD off).
  `filePathFields` idea: tag asset-reference fields in every payload so the ticket-rewrite step cannot miss one.
- Audio is a stated non-goal; if added later, keep Foundry's split: shared playback state, client-local volume, and do
  not leak playlist names the GM wants hidden (name-only visibility).

---------------------------------------------------------------------------------------------------
## 9. Mobile/touch and performance

- Official stance: "At this time Foundry VTT does not support mobile devices as part of the core software"; Android
  partially via add-ons; iPad not supported due to Safari/WebKit limits. FAQ (updated for 13.351):
  https://foundryvtt.com/article/faq/ . No official performance guidance found on fetched pages (FAQ points to a
  separate "Minimum Requirements" article that we could not fetch).
- Third-party modules show what is needed on phones [COMMUNITY]: touch gestures, pinch zoom, token drag, long-press as
  right click, performance throttles for FPS/heat, Safari fixes.
  https://foundryvtt.com/packages/touch-vtt ; https://foundryvtt.com/packages/swipe-vtt ;
  https://foundryvtt.com/packages/mobile-improvements
- Foundry's `Preload` scene action and `waitForImages` (FilePicker) show asset warm-up is a recognised need.

How it could inform us: our phone-first player app is an advantage (explicit design target Foundry lacks). Build touch
primitives first (pinch zoom, drag token with long-press for context actions, no hover-only UI, large hit areas) and a
quality switch (reduced lighting resolution) per the G3b GPU-gate. Borrow Foundry's "player sees nothing in the scene
without an owned vision token" as a stable perf-friendly rule (only one vision computation per seat).

---------------------------------------------------------------------------------------------------
## 10. Borrow / Adapt / Skip for our project

BORROW (use nearly as is)
1. Ownership ladder NONE / LIMITED / OBSERVER / OWNER + `default` + per-seat map; `project(entity, level)` pure function
   per entity. -> spec G3a, G4, G6, anti-goals; M3-M5. (Sec. 2)
2. Four roll modes (public, gm, blind, self) built on `whisper[]` + `blind`; GM-only RNG; roll JSON with per-term results.
   -> G5, M3. (Sec. 7)
3. Operation envelope with partial `diff` updates + per-entity `rev`/`modifiedTime` + full snapshot on join/reconnect.
   -> M2 protocol, M3 reconnect. (Sec. 3)
4. `flags.<scope>` extension bag on every entity, relay-transparent. -> M0 protocol freeze, plugin surface. (Sec. 1, 4)
5. Pings (PULSE/ALERT/PULL) and shared player color on cursor/ruler/chat; permission-gated. -> M3/M4 UX. (Sec. 6, 8)
6. Pause flag blocking player moves; active-scene vs per-seat viewed-scene; Preload message. -> G3a, G4, G8. (Sec. 6)
7. Per-(scene, seat) fog-exploration persistence stored GM-side and reset action. -> M3/M4 `explored` handling. (Sec. 6)
8. Show Players push + `enrichHTML({secrets:false})`-style strip-then-send for notes, with secret-block ids and reveal.
   -> G6, M5, leak anti-goal. (Sec. 5)
9. Initiative projection: hidden combatants omitted, defeated faded, players end only own turn. -> G5, M3. (Sec. 7)

ADAPT (change the shape to fit our architecture)
10. "Server validates" -> "GM client validates": every player action is an intent; copy socketlib's `executeAsGM`
    semantics (single executor). Foundry's pre-hook vs post-hook split becomes optimistic-local-move + GM accept/refuse.
    (Sec. 3, G4)
11. Hooks bus (`on/once/off/call/callAll`, `call` stops on false) only on the GM client, with `pre*` cancellable hooks for
    move/share/roll and `callAll` notifications; plugin manifest with protocol `compat {min,verified,max}`. (Sec. 4)
12. Subtype declaration of `htmlFields` / `filePathFields` -> payload schema annotations used by the sanitizer and the
    signed-ticket rewriter and by leak tests. (Sec. 1, 8; G8)
13. Journal: pages as OBSERVER share with LIMITED = pin/title-only; Markdown first-class (Foundry has a markdown page
    format); links to unshared notes render as plain alias text. (Sec. 5, G6)
14. `migrateData` pattern (client-side upgrade of older payloads) instead of a version integer; keep protocol `v` for
    breaking changes only. (Sec. 1)
15. USER_PERMISSIONS table reduced to ~8 toggles (PING, CURSOR, RULER, WHISPER, MANUAL_ROLLS, DRAW, NOTE_PIN, DOORS)
    with per-table/per-seat GM override. (Sec. 2)
16. Token vision rule ("no vision token => no scene") as our fail-closed default for lit scenes. (Sec. 6, G3b)

SKIP (not worth it for MVP / mismatched)
17. Document-database server, compendiums, world packages, setup screens, license/auth flows. Our relay stays stateless.
18. Account/password model, user roles NONE/TRUSTED/ASSISTANT (we have GM vs seats; ASSISTANT/co-GM = future role flag).
19. FilePicker/upload by players, s3 source, in-app asset browser. (Server image cache covers needs, G8.)
20. Playlists/audio, A/V chat, macros/script permissions (MACRO_SCRIPT, QUERY_USER) - non-goals or security risk.
21. Actor/Item/Cards/Regions/Levels document universe and system data models (character sheets out of MVP).
22. Foundry's mobile UI: unsupported by core; only borrow lessons from add-ons (touch gestures, thermal throttling).

---------------------------------------------------------------------------------------------------
## Gaps (not verified in this research)
- /article/hooks/, /article/permissions/, /article/vision/, /article/canvas-ping/, /article/file-upload/, /article/audio/ and
  the community sockets wiki page returned 404 or empty bodies; their content was inferred from API pages and search
  snippets only where explicitly marked.
- Scene.grid/fog/environment subfields, TokenDocument `hidden`/`sight`, `_stats` field list, DocumentOwnershipField shape,
  Dice So Nice hook names, and official image-optimization statements were not confirmed from official pages.
