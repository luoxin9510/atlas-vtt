# Foundry VTT: player and GM experience, lessons for the Atlas fork

Researched 2026-10-26. Official sources: foundryvtt.com/article/* and /releases/*. Pages were read through a
summarising fetcher, so wording is paraphrased. Where an official page is silent, that is said
explicitly ("not documented") instead of guessed. Community sources are marked [community].
Latest stables at time of writing: v14.369 (2026-10-08), v13.351 (2025-11-12), v12.343 (2025-05-08)
(https://foundryvtt.com/releases/).
Caution: a web search for "websocket proxy HTTP/2 downgrade" returned text from Palantir Foundry docs
(an unrelated product). That was discarded and is not used below.

---------------------------------------------------------------------------
## 1. Player flow, step by step (https://foundryvtt.com/article/player-orientation/)

1. Open the server address (invitation link) the GM sends in a normal browser.
2. Login screen: pick your username from a list of pre-created users (no sign-up).
3. Enter a password if the user has one (optional but "strongly recommended", esp. for GM users;
   new users start with none). Source: https://foundryvtt.com/article/users/
4. Wait for session connect and world load; you land on the active scene. Users with a token
   in the scene start centred on their token (https://foundryvtt.com/article/scenes/).
5. First visit: Player Configuration opens: user colour (cursor, ruler, name dot), optional avatar,
   claim a character the GM granted. Reopen via right-click on your name in the player list.
   (player-orientation; users article)
6. Roles: None, Player, Trusted (adds drawings, templates, optional uploads), Assistant GM, GM.
   Document ownership: None / Limited / Observer / Owner. (https://foundryvtt.com/article/users/)

UI a player sees (player-orientation):
- Scene navigation bar (v13: a collapsed menu), pause indicator (spinning clock; while paused players
  cannot move tokens or operate doors), layer controls (Basic/tokens, Measurement, Journal Notes).
- Sidebar tabs: Chat, Combat, Actors, Items, Journals, Roll Tables, Playlists, Card Stacks,
  Compendium Packs, Settings. Compendia "rarely needed" by players.
- Player list (colours; collapsed = signed-in users only), macro hotbar (10 slots, up to 4 pages),
  default roll mode selector, chat entry box.
- v13 redesign: ApplicationV2 UI, sidebar becomes a collapsed "cabinet", chat input visible on every
  tab, a notification tray shows recent messages briefly, roll mode is four icons, light/dark themes
  follow OS, UI scale and auto-fade settings. (https://foundryvtt.com/releases/13.341)

Phone relevance (our judgement): must-have = scene canvas, chat/dice, initiative list, player list
(who is online), journal reader. Skip on phone = Actors/Items/Cards/Playlists/Compendia, macro hotbar,
Settings tab, scene navigation bar (GM switches scenes for everyone anyway).

Key design point: login is "pick a pre-made user + optional password". Our link+code+name
flow is simpler and matches the same mental model (GM provisions seats, players pick).

---------------------------------------------------------------------------
## 2. Self-hosting

Facts:
- Node.js server or desktop app; default port 30000 (`port` in options.json or `--port`).
  https://foundryvtt.com/article/configuration/
- Node requirement: 22 for v13 and below, 24 for v14+. Run under systemd (standalone) or PM2.
  https://foundryvtt.com/article/installation/
- `options.json` lives in `Config/`; strict JSON, malformed file prevents start. Setup UI edits it and
  restarts. Directives: `port`, `upnp`, `hostname` (replaces public IP in invitation links),
  `routePrefix` (sub-path hosting), `proxySSL`, `proxyPort`, `sslCert`/`sslKey`, `dataPath`,
  `awsConfig` (S3 for assets/backups). https://foundryvtt.com/article/configuration/
- Data folder: user data dir with `Config/` (options.json, encrypted admin key in admin.txt), `Data/`
  (`systems/`, `modules/`, `worlds/`, plus user assets; "anything here is publicly served"), `Logs/`.
  Backup = zip of the user data folder; sync services must be upload-only to avoid data loss. Data
  path precedence: CLI flag, env FOUNDRY_VTT_DATA_PATH, config override, OS default. Same article.
- Invitation links: built from public IP (or `hostname`); players use a plain browser. Testing the
  "internet" link from the host machine often fails (router hairpin); test from a phone on mobile data.
  https://foundryvtt.com/article/port-forwarding/ . Port forwarding / UPnP / CG-NAT are the main
  host pain; IPv6 may skip forwarding. v14 adds optional built-in HTTPS (free cert request, self-signed
  fallback) and IPv6 reachability check on invite links. https://foundryvtt.com/releases/14.369
- Hosting options: self-hosted, cloud-hosted (Node on VPS), partner-hosted; bandwidth, especially
  host upload with big media, is the main performance limit. https://foundryvtt.com/article/hosting/
- Licence: players need no licence; one licence covers unlimited players; a licence may be actively
  used by one publicly accessible server at a time (dev copy private is allowed).
  https://foundryvtt.com/article/faq/ and https://foundryvtt.com/article/license/
  (the licence page says "only one hosted instance may be accessible to users other than the owner").
- Requirements: self-host upload ~12 Mbps recommended, 6 Mbps workable but slow; server min 1 vCPU/
  2 GB RAM, recommended 2 vCPU/4 GB. Client min: integrated GPU w/ hardware accel, 8 GB RAM, 1366x768,
  Chrome/Firefox/Edge; "Safari is not a supported browser". https://foundryvtt.com/article/requirements/
- Reverse proxy (nginx guide): `location /` must set `Upgrade $http_upgrade` and `Connection "Upgrade"`
  for WebSockets, forward Host / X-Forwarded-For / X-Forwarded-Proto, `client_max_body_size 300M`;
  set `proxySSL: true` and `proxyPort: 443` in options.json; `hostname` must match the domain;
  restart both nginx and Foundry after changes; sub-folder hosting needs `routePrefix`; do not serve
  Foundry static files through the proxy ("error-prone"). https://foundryvtt.com/article/nginx/
  Also Caddy and Apache articles exist: https://foundryvtt.com/article/caddy/ , /article/apache/
- A/V chat needs SSL, WebRTC P2P by default (UDP), can use Jitsi or LiveKit or a relay.
  https://foundryvtt.com/article/audio-video/ . (We do not need A/V.)

What breaks behind proxies (official notes above): missing WebSocket upgrade headers, wrong proxySSL/
proxyPort giving wrong invitation links, upload size limits, hostname mismatch, forgotten restarts.

Lessons for our relay and deployment:
- Our spec 6.5 already covers the same list (Upgrade headers, 512 KiB frames, 9 MiB bodies). Add to
  the M2/M6 checklist: a "public origin" setting that drives the join link (Foundry's `hostname`), tested
  from a phone on mobile data, not from the server's own LAN.
- Foundry sends the invitation link from a *config value*; so should the GM plugin (show link + QR
  built from the configured origin, spec G1).
- One licence key per GM maps to our single HOST_KEY; players never need a key. Good.
- Foundry's data layout (Config / Data / Logs split, everything under one dir, zip = backup) is a good
  model for the relay's state dir: one directory (state JSON, assets cache, logs), documented backup.
- Foundry offers optional built-in HTTPS; for us TLS stays at Caddy/nginx (spec 6.5). Fine.

---------------------------------------------------------------------------
## 3. Journals and handouts (https://foundryvtt.com/article/journal/)

- Share: "Show Players" from the entry heading menu (all players by default, or pick individuals).
  In multipage view, right-click a page and "Show Players" shares just that page.
- Entry permission levels: None (default), Limited (map pin visible, double-click shows the image
  only, not text), Observer (can open, switch image/text), Owner (edit). Per-document, per-user.
- Secret blocks: GM/Owner only; a reveal button makes it visible to players viewing the page.
- Image pages: upload or external URL. (A dedicated image-popout article was not found, 404.)
- Linking: `@UUID[Type.ID]{Label}`, drag-drop to make links, header links; "Links open the target
  document only if the viewer has permission to see it".
- Monk's Common Display [community] (https://foundryvtt.com/packages/monks-common-display) adds a
  toolbar to clear shared journals/images and auto-clear after a timeout: players like handouts that
  disappear.

Lessons for 6.4 shared notes:
- Per-page share (not only per-note) is the unit people use; our `atlas-share: true` per note matches.
- "Link only works if you can see the target; else plain label" is exactly our 6.4 rule. Foundry
  confirms the model. Note Foundry still shows link *labels*; we go further (alias only, no path).
- Secret block = our `[!gm]` callout / `%%comments%%`. Foundry's secrets are revealable with a button;
  that "reveal one secret" action is a nice later feature: `atlas-reveal` for one callout.
- Limited level (image visible, text hidden) = "handout image only". Cheap later feature: share an
  image alone, no note.
- Transient "show to players now" popup is the heart of the handout UX. Consider an M5+ "push note to
  all players' screen" button on the GM side.

---------------------------------------------------------------------------
## 4. Chat and dice (https://foundryvtt.com/article/chat/ , /dice/ , /dice-modifiers/)

Official:
- Roll modes: public, private GM (`/gmroll`, `/gmr`), blind GM (`/blindroll`, `/br`), self (`/selfroll`,
  `/sr`); `/roll` (`/r`) follows the default mode, `/pr` forces public. v13 picks mode with four
  icons. The dropdown/icons set the mode for automated rolls from systems/modules/macros.
- Whispers: `/w` or `/whisper` with names in brackets; keywords `gm`, `players`; needs the "Whisper
  Private Messages" permission; GMs cannot see whispers not addressed to them.
- `/ic` speak as character, `/ooc` out of character (outlined in player colour), `/emote` `/em` `/me`.
- Chat bubbles above tokens for IC/emote messages (client setting).
- Clicking a roll expands per-die tooltip.
- Dice syntax: `NdX`, `+ - * /`, parentheses (`(1d8+4)*2`), `# description` after a roll, `[label]`
  after a term; inline rolls `[[2d12]]` (immediate) and `[[/roll 1d10]]` (deferred click button),
  `[[formula]]{label}`. Modifiers: keep/drop `k kh kl d dl dh`; explode `x xo`; reroll `r rr`;
  count successes `cs`, `even`, `odd`.
- Chat entry is visible in every sidebar tab since v13; `Shift+C` focuses chat input (13.351 notes).
- Dice So Nice [community] is the most consistently recommended module (3D dice animation).
  https://foundryvtt-hub.com/package/dice-so-nice . The Foundry Hub itself warns that "no essential
  module list exists" and 3D dice are a taste item. https://www.foundryvtt-hub.com/featured/official-foundry-hub-recommended-module-list

Not documented on those pages: chat cards (system-specific), "pop-out" behaviour.

MVP vs later (our dice engine already has parseFormula limits per CLAUDE.md):
- MVP (M3): public roll, roll modes public / GM-only / self (blind optional), `NdX+k`, label text,
  per-die breakdown on tap, whisper to GM (button, not a typed command on a phone), log entries
  showing who rolled.
- Later: whispers to other players, keep/drop/explode/reroll modifiers (we already support exploding),
  inline `[[...]]` rolls in shared notes (click to roll), emotes/OOC, chat bubbles, 3D dice display.
- Skip: `/ic` `/ooc` command set, macros.
- Phone UX: Foundry assumes a keyboard and slash commands; on a phone use a dice tray with chips
  (d4..d20, modifier stepper, mode toggle) and quick buttons.

---------------------------------------------------------------------------
## 5. Token interaction for players

Official (https://foundryvtt.com/article/tokens/ , /article/player-orientation/ , /article/measurement/ ,
/article/pings/ , /releases/13.341):
- Select: only tokens you own can be manipulated; with several vision tokens and none selected your
  view is the combined vision of all.
- Move: drag; move executes on release with a live ruler showing distance (v13 default "simple movement").
  Arrow/WASD keys for small moves; Shift rotates. Walls stop you with a notice.
- Waypoints (complex movement, v13): Ctrl/Cmd+click to start/add waypoint, right-click removes,
  Esc cancels, Tab cycles movement types, wheel changes elevation; ruler tool also: R key toggles,
  Space moves the token along the ruler path; Place Waypoint key F. GM holds Alt to hide movement
  from players. https://foundryvtt.com/article/measurement/ , releases/13.341
- Movement animation: tokens turn to face movement direction (v13 unless rotation locked); in v12 a
  token moving along a ruler path can be controlled during the animation. releases/12.328
- Targeting: Select Targets tool; click targets, Shift adds, drag box targets all inside. Targets are
  cleared on scene change (v12.328).
- Token HUD (right-click on own token): resource bars, status effects, elevation, target toggle,
  toggle combat. Status effect icons top-left; right-click an icon for a large overlay.
- Pause: "While paused, players may not move their tokens or manipulate doors."
- Pings (https://foundryvtt.com/article/pings/): hold left click = pulse in user colour; Alt+hold =
  red warning triangle; Shift+hold = "drag ping" that pulls all cameras to the spot, GM/Assistant only.
  Touch is not mentioned in the article.
- Pull to scene: a GM-only scene becomes visible to players only if GM activates it or uses pull to
  scene; Activate pulls everyone, View Scene is local. https://foundryvtt.com/article/scenes/
- Measured templates: circle, cone (default 53 degrees), rectangle, ray; snap to grid; Trusted role
  and above can place them; only GM clears all. https://foundryvtt.com/article/measurement/
  Touch not mentioned. (TouchVTT adds an eraser and touch template handling [community].)
- Token drag vision (world setting): previews vision/lighting while dragging.
  https://foundryvtt.com/article/settings/
- Visibility: with Token Vision on, a player needs an owned token with vision to see the scene.
  Players cannot lock/hide their own tokens (14.369). Observed tokens become visible immediately.

Lessons / MVP split:
- MVP (M4): drag own token, live distance readout while dragging (GM already has drag ruler),
  refusal toast (`move-refused`), move on release, snap to grid, auto-rotate off.
- Later: waypoint path (tap to add waypoint while dragging is hard on a phone; use a "path mode" button),
  token HUD as a bottom sheet (conditions, resource, "target"), ping (long-press on map, 0.5 s),
  GM "pull view" ping, templates (GM-placed, visible to players; player-placed later).
- Skip: elevation, movement types, region costs, keyboard movement.
- Target/conditions display on tokens: show GM-chosen conditions icons read-only in M4+.

---------------------------------------------------------------------------
## 6. Combat tracker for players (https://foundryvtt.com/article/combat/)

- Players roll initiative for their own combatant ("Roll Initiative" button); GM can roll all or NPCs.
- "End Turn" button appears only for a player whose character is currently taking its turn; NPC
  turns are advanced by GM/Assistant ("Next Turn").
- Hidden combatants are removed from the player view entirely; defeated ones appear faded; "Skip
  Defeated" option.
- Turn notification: not documented on this page. v13 adds a turn marker beneath the active token with
  animation options (https://foundryvtt.com/releases/13.341); marker updates correctly when combat
  ends (13.351). I did not find an official "it's your turn" alert; community modules fill that gap.
- v13: chat entry visible on every tab, so combat can stay open while chatting.

Lessons: our spec already hides hidden tokens' entries in the players' list (CLAUDE.md Initiative
section matches Foundry's "Hidden hides the entry from players completely"). For M3 add: highlight
the active row, and for the player whose token is active: a banner/vibration/sound "Your turn" plus an
"End turn" button (GM-approved). End-turn is a protocol addition (player message), mark as M3.5/M4.
Self-roll initiative button: later (GM rolls all today).

---------------------------------------------------------------------------
## 7. Mobile and touch

Official:
- FAQ: "core software does not support mobile devices, though the team plans to add support later";
  iPads unsupported (cites Safari/WebKit limits). https://foundryvtt.com/article/faq/
  (This FAQ text may be dated; the requirements page, current, still says Safari is not supported:
  https://foundryvtt.com/article/requirements/)
- v13: "multitouch pinch zoom works as expected instead of rotating tokens". https://foundryvtt.com/releases/13.341
- v13.351 and v14.369 release notes contain no touch/mobile items. No dedicated touch mode exists in
  v12/v13/v14 per the notes I read.
- Pings, rulers and templates articles do not mention touch.
Community / informal:
- [community] A Foundry staff comment on Reddit (via search result; unverified secondhand): touch/tablet
  support was dropped from the v11 poll, v13 brought some improvements, official support "not viable
  yet", and phones are a separate harder problem. https://reddit.birdcat.cafe/r/FoundryVTT/comments/1kt0vs5/v14_feature_article
- [community] TouchVTT (Aioros, v2.3.13, verified 13.351): pinch zoom, two-finger pan (or three-finger),
  finger-drag tokens, tap to target hostile, long-press (~0.5 s) = right-click, rotation buttons in
  HUD, touch ruler with waypoints and move-along-path, eraser for templates, bigger left menu
  buttons. Aimed at tablets/touch TVs. https://foundryvtt.com/packages/touch-vtt/
- [community] Swipe VTT (v13+, Patreon-gated parts): phone layout, tap select/target, drag move,
  double-tap sheet, long-press HUD, two-finger pan, pinch zoom, avatar carousel of owned characters,
  quick buttons (volume, ruler, template, logout), Safari/iOS fixes, FPS/heat optimisation, image
  compression, compact 5e/Daggerheart sheets, mobile journal reading. https://foundryvtt.com/packages/swipe-vtt
- [community] Simple Mobile: Android only, experimental performance mode, old (verified 0.8.9).
  https://foundryvtt.com/packages/simplemobile
- [community] PocketScroll: iPhone/iPad companion app requiring a Foundry module on the server
  (search snippet only, page 404).
- [community] Monk's Common Display: TV/shared screen mode. https://foundryvtt.com/packages/monks-common-display

Why people like them (inference from the feature lists): a single gesture vocabulary (tap select,
drag move, long-press = context menu, two-finger pan, pinch), a performance/heat mode, a phone-sized
layout for sheet + dice, and a carousel of own characters.

Lessons: this is our biggest differentiator. Foundry leaves phones to modules; we make them first
class. Adopt the TouchVTT/Swipe gesture set: one finger on empty map = pan (or two-finger), pinch =
zoom, drag own token = move, tap token = select/info, long-press = HUD/ping. Never rotate tokens on
pinch (Foundry bug fixed in v13). Provide a low-power mode (FPS cap), because Foundry itself exposes
"Maximum Framerate" and "Performance Mode" client settings (settings article).

---------------------------------------------------------------------------
## 8. Quality-of-life features (core and community)

Core:
- Pause game: players cannot move tokens or operate doors; spinning clock indicator.
  https://foundryvtt.com/article/player-orientation/
- Player list with colours; collapsed shows signed-in users only. Online/AFK indicator: not
  documented (https://foundryvtt.com/article/users/ says online status not covered).
- Scene preload: GM asks all connected clients to preload a scene's assets without switching.
  Initial View Position; start centred on own token. https://foundryvtt.com/article/scenes/
- Fog exploration is per user and saved; setting for unexplored/explored colours; "areas currently
  visible are not tinted". Reset of exploration: not described in that article (exists in the UI,
  unverified here). Global illumination, darkness level, GI threshold. Same article.
- Token vision animation, light animation toggles, Disable Game Canvas, FPS cap, performance mode:
  https://foundryvtt.com/article/settings/
- Pings with warning variant and GM drag ping that pulls cameras. https://foundryvtt.com/article/pings/
- Notification tray of recent chat when sidebar collapsed (v13).
- Playlists with volume sliders (Playlist/Ambient/Interface). player-orientation.
- Dynamic token rings (v12), door animations, turn markers, sound-reactive lights (v13).
Community:
- Dice So Nice, Monk's Common Display, Token Magic FX, libwrapper, Midi-QOL (5e automation),
  Dice Tray, importers. [community] https://foundryvtt-hub.com/package/dice-so-nice ,
  https://courses.theabundantartist.com/best-foundry-modules-for-dnd-5e/ , 2022/2020 Reddit threads via search.
  Hub says lists age fast and many are 5e-specific [community].
- "Follow GM view / camera sync": core has only the GM drag ping (Shift+hold). Common Display mirrors a
  chosen player's view. Our PlayerFrame model already makes the GM's view the players' view.

Our priorities: pause, online list, GM view sync (already inherent), scene switch with loading
indicator, preload, turn alert, ping.

---------------------------------------------------------------------------
## 9. Pain points to avoid

- Learning curve and complexity [community]: repeated in a 2024 Reddit comparison thread and comparison
  sites; the Hub tells newcomers to learn core before adding modules. https://lr.ggtyler.dev/r/VTT/comments/1apxked/should_i_switch_to_foundry/kqe3r89/ and
  https://www.foundryvtt-hub.com/featured/official-foundry-hub-recommended-module-list
- Setup/networking [community + official]: port forwarding, CG-NAT, hairpin testing failures; the
  official port-forwarding page lists VPNs (ZeroTier/Hamachi) or cloud hosting as fallbacks.
  https://foundryvtt.com/article/port-forwarding/
- Performance on weak devices: hardware-accel + 8 GB RAM minimum on desktop; Safari unsupported;
  settings exist to lower load. https://foundryvtt.com/article/requirements/ , /settings/
  Heavy module worlds load slowly [community, Forge forum] https://forums.forge-vtt.com/ (search snippet).
- Host upload bandwidth: 12 Mbps recommended; slow hosts are told to use S3/CDN for assets.
  Requirements article. This is our G8 server-side image cache.
- Licence: one hosted instance accessible to others at a time; each GM pays; players free.
  https://foundryvtt.com/article/license/
- Upgrade friction: v13 cannot update in-app, irreversible migration, modules disabled on first launch,
  compatibility gaps. https://foundryvtt.com/releases/13.341
- Security: v13.351 patched remote-code-execution bugs in document modification, urging public hosts to
  update. https://foundryvtt.com/releases/13.351 (Lesson: our relay never executes player data; keep it so.)
- Mobile: no official support (see 7).
- No China-specific data found. Direct Foundry hosting from the mainland is untested in sources.

---------------------------------------------------------------------------
## For our roadmap

Legend: MVP = in current milestones, LATER = after M6, SKIP = do not build.

MVP-worthy
- Join by link + name + code, pre-provisioned seats, returning player recognised (G2, M3). Foundry's
  user-pick + optional password confirms this is the right level of ceremony; no sign-up.
- Public / GM-only / self roll modes, dice tray with chips, per-die tooltip, `NdX` with +/- and parens,
  roll label text (G5, M3). Core to every player action; keep modifiers small.
- Players list with online/offline state and a GM-offline banner (6.3, M3). Foundry has the list;
  online status matters more over a flaky link.
- Pause toggle that freezes token drags and shows an indicator (M4, small protocol add). Foundry's
  most-used GM control; cheap and prevents rule disputes.
- Own-token drag with live distance and refusal toast; move on release (G4, M4). Matches Foundry's
  "simple movement".
- Touch gestures: one/two-finger pan, pinch zoom without token rotation, long-press = menu (M3/M4).
  The TouchVTT/Swipe set is what players of mobile Foundry use.
- Initiative list with active-row highlight and hidden-entry removal (G5, M3).
- "Your turn" alert (banner/vibrate) plus End turn request (M3/M4). Foundry shows End Turn only to the
  active owner.
- Read shared notes with image handouts, secret = `[!gm]`, unresolved links as plain text (G6, M5).
- Low-power client setting (FPS cap, no animations) (M3/M4). Foundry exposes it because weak devices
  suffer; phones in China more so.
- Join link built from a configured public origin; test from a phone on mobile data (M2/M6).
  Mirrors Foundry's `hostname`/`proxySSL` lessons.
- WebSocket proxy checklist in deployment docs (Upgrade headers, body size, restarts) (M6).

LATER
- Ping on map: long-press pulse in the player's colour, warning variant, GM "pull everyone's view" ping
  (post-M4; core has these, touch not covered).
- Push a note or image to all players' screens now with auto-dismiss (M5+; Show Players and Common Display).
- Page-level/handout-only sharing and reveal-one-secret (M5+; Foundry Limited/Observer, secret reveal).
- Whisper to another player, emote/OOC, chat bubbles above tokens.
- Dice modifiers beyond what we have (keep/drop/reroll/count successes), inline `[[roll]]` in notes.
- Scene preload command and a loading indicator (M4+; Foundry Preload).
- Token HUD as bottom sheet: conditions read-only, resource bar, target.
- Player-placed measured templates (circle/cone/ray/rect) and GM-placed templates visible to all.
- Waypoint path mode for movement.
- Fog exploration reset control on the GM side, scene "initial view" (already partly in Atlas).
- 3D dice display (Atlas already has dice3d; players' client later).
- Companion character-sheet view (out of MVP by spec; Swipe VTT shows the demand).

SKIP
- Roles/permission matrix, document ownership levels (we have GM + seats only).
- Macros/hotbar, compendia, actors/items/cards/playlists tabs, roll tables for players.
- Keyboard-first shortcuts and slash-command-only features on phones.
- In-app A/V chat (Foundry needs SSL + WebRTC; players use their own voice app).
- Module ecosystem / scripting API for players.
- Elevation, movement types, region movement cost.
- Per-player licence or account model.

Dependencies to schedule
- Pause, End turn, ping, push-handout need new fork-protocol messages (6.3 `client` forkLevel gating).
- Touch gesture work belongs to M3 (view) and M4 (drag); do not leave it to M6 testing.
- Low-power mode: M3 renderer option, tested on real phones in M6.
