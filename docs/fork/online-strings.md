# Online strings: inventory (Task 4)

Every user-facing string of the self-hosted online feature (GM side `src/app/online/gm/`, the shared table log `src/app/online/tableLog/`, `src/app/online/marks/` and `src/app/plugin/onlinePlay.ts`) now goes through `t()`. English output is byte-identical; Simplified Chinese follows `zh-glossary.md` with the extra online terms: 联机桌 (table), 主持 (host), 加入码 (join code), 加入链接 (join link), 座位 (seat), 请求加入 (knock), 允许加入 (admit), 拒绝 (decline), 移出 (kick), 主持密钥 (host key), 联机服务器地址 (online server address), 中转服务器 (relay server).

Modules: `onlineGm` (settings, account and host key, table start and end, notices, commands), `onlineDock` (the dock control, connection menu and panel), `onlineLog` (the table log panel, chat commands, refusals). Each is under 250 keys, so none was split further. `src/app/online/marks/` shows no text (cursor tags carry player names only), so nothing there was wired.

## Wired strings

Columns: key, first use (file:line, relative to `src/app/`), English text (plural keys show the `other` form).

### gm/account

| Key | Where | English |
|---|---|---|
| `onlineGm.access.noAccess` | online/gm/account/accountView.ts:47 | Online play is in early access. Redeem an invite key on your account page. |
| `onlineGm.access.ended` | online/gm/account/accountView.ts:48 | Your access to online play has ended. See your account page. |
| `onlineGm.access.revoked` | online/gm/account/accountView.ts:49 | Your access to online play was withdrawn. See your account page. |
| `onlineGm.access.restricted` | online/gm/account/accountView.ts:50 | Your account is restricted and cannot host online tables. See your account page. |
| `onlineGm.access.termsNotAccepted` | online/gm/account/accountView.ts:51 | Accept the current Terms on your account page to host online tables. |
| `onlineGm.access.noHosting` | online/gm/account/accountView.ts:55 | This account may not host online tables now. |
| `onlineGm.access.noHostingSee` | online/gm/account/accountView.ts:58 | This account may not host online tables now. See your account page. |
| `onlineGm.hostKey.set` | online/gm/account/accountView.ts:60 | Host key set |
| `onlineGm.hostKey.none` | online/gm/account/accountView.ts:61 | No host key yet |
| `onlineGm.hostKey.refused` | online/gm/account/accountView.ts:62 | The host key is not accepted by this server. |
| `onlineGm.account.unreachable` | online/gm/account/accountView.ts:64 | Can’t reach Atlas sign-in right now. |
| `onlineGm.account.serverSignedOut` | online/gm/account/accountView.ts:65 | You were signed out. Running tables keep going. |
| `onlineGm.account.timedOut` | online/gm/account/accountView.ts:70 | Sign-in timed out. |
| `onlineGm.account.declined` | online/gm/account/accountView.ts:71 | Sign-in was declined. |
| `onlineGm.plan.beta` | online/gm/account/accountView.ts:78 | Early access |
| `onlineGm.plan.free` | online/gm/account/accountView.ts:78 | Free |
| `onlineGm.plan.host` | online/gm/account/accountView.ts:78 | Host |
| `onlineGm.plan.staff` | online/gm/account/accountView.ts:78 | Staff |
| `onlineGm.plan.players` | online/gm/account/accountView.ts:82 | {count} players |
| `onlineGm.plan.upTo` | online/gm/account/accountView.ts:83 | {plan} · up to {players} |
| `onlineGm.account.approve` | online/gm/account/accountSettings.ts:10 | Approve the sign-in in your browser. |
| `onlineGm.account.checking` | online/gm/account/accountSettings.ts:11, online/gm/dock/accountMenu.ts:123 | Checking your account… |
| `onlineGm.account.signedInRefused` | online/gm/account/accountSettings.ts:13 | Signed in as {account}. {reason} |
| `onlineGm.account.signedInPlan` | online/gm/account/accountSettings.ts:14 | Signed in as {account} · {plan} |
| `onlineGm.account.signedOut` | online/gm/account/accountSettings.ts:15 | Not signed in. Sign in to host online tables with your Atlas account. |
| `onlineGm.account.heading` | online/gm/account/accountSettings.ts:27 | Online account |
| `onlineGm.account.name` | online/gm/account/accountSettings.ts:29 | Atlas account |
| `onlineGm.account.signOut` | online/gm/account/accountSettings.ts:39, online/gm/dock/accountMenu.ts:69 | Sign out |
| `onlineGm.account.signIn` | online/gm/account/accountSettings.ts:40 | Sign in |
| `onlineGm.account.openPage` | online/gm/account/accountSettings.ts:43, online/gm/dock/accountMenu.ts:76 | Open account page |
| `onlineGm.account.noStorageHostKey` | online/gm/account/AccountControl.ts:70 | Obsidian cannot keep the host key on this device: its secure storage is not available. |
| `onlineGm.account.noStorageSignIn` | online/gm/account/AccountControl.ts:113 | Obsidian cannot keep the sign-in on this device: its secure storage is not available. |

### gm

| Key | Where | English |
|---|---|---|
| `onlineGm.server.addressHelp` | online/gm/serverSettings.ts:12 | The address of the server you host online tables on. Leave it empty to keep online play off. |
| `onlineGm.server.addressInvalid` | online/gm/serverSettings.ts:13 | Enter an address such as https://play.example.com. |
| `onlineGm.server.hostKeyHelp` | online/gm/serverSettings.ts:14 | The key your server gave you for hosting tables. It stays in Obsidian's secret storage on this device. |
| `onlineGm.server.heading` | online/gm/serverSettings.ts:35 | Online server |
| `onlineGm.server.addressName` | online/gm/serverSettings.ts:37 | Online server address |
| `onlineGm.server.hostKeyName` | online/gm/serverSettings.ts:56 | Host key |
| `onlineGm.server.hostKeyReplace` | online/gm/serverSettings.ts:66 | Host key set. Paste a new one to replace it. |
| `onlineGm.server.hostKeyPaste` | online/gm/serverSettings.ts:66 | Paste the host key |
| `onlineGm.server.hostKeyRemove` | online/gm/serverSettings.ts:74 | Remove |
| `onlineGm.diagnostics.heading` | online/gm/settings.ts:43 | Online diagnostics |
| `onlineGm.diagnostics.sendReports` | online/gm/settings.ts:45 | Send error reports |
| `onlineGm.diagnostics.reportsNote` | online/gm/companionReports.ts:5 | Off unless you switch it on. Errors of Atlas Online then go to the table server: the error's name, message and stack with codes, keys and names removed, the versions of Atlas Online, Atlas and Obsidian, the system family and a hash of the table code. Never your notes, maps or players. Kept for {days} days. |
| `onlineGm.seats.noCampaign` | online/gm/campaignSeats.ts:13 | Choose a campaign first. |
| `onlineGm.seats.noTable` | online/gm/campaignSeats.ts:16 | Start an online table first. |
| `onlineGm.seats.newerPlayers` | online/gm/campaignSeats.ts:19 | This campaign's players file is from a newer Atlas. |
| `onlineGm.seats.loading` | online/gm/campaignSeats.ts:22 | The campaigns are still loading. Try again in a moment. |
| `onlineGm.seats.noFolder` | online/gm/campaignSeats.ts:27 | This campaign has no folder in the vault. |
| `onlineGm.seats.noRoom` | online/gm/campaignSeats.ts:132 | The campaign has no room for {name}. |
| `onlineGm.create.unreachable` | online/gm/createTable.ts:26 | The server could not be reached. |
| `onlineGm.create.linkTaken` | online/gm/createdTable.ts:22 | This campaign's link belongs to another account. Make a new link. |
| `onlineGm.create.tooMany` | online/gm/createdTable.ts:30 | Too many tries. Try again in a minute. |
| `onlineGm.create.notConfigured` | online/gm/createdTable.ts:32 | This server hosts no tables for Atlas accounts. |
| `onlineGm.create.unavailable` | online/gm/createdTable.ts:33 | The server could not create a table. Try again in a moment. |
| `onlineGm.create.failed` | online/gm/createdTable.ts:34 | The server could not create a table ({status}). |
| `onlineGm.outdated` | online/gm/gmLevel.ts:15 | Online play needs a newer Atlas. |
| `onlineGm.updateAfter` | online/gm/gmLevel.ts:16 | Update Atlas after this session |
| `onlineGm.gate.paused` | online/gm/joinGate.ts:31 | Joins paused: too many wrong codes |
| `onlineGm.command.start` | online/gm/onlineCommands.ts:4 | Start online table |
| `onlineGm.command.toggle` | online/gm/onlineCommands.ts:5 | Toggle online panel |
| `onlineGm.command.copyLink` | online/gm/onlineCommands.ts:6 | Copy online table link |
| `onlineGm.command.playerTokens` | online/gm/onlineCommands.ts:7 | Make selected tokens player tokens |
| `onlineGm.command.gmTokens` | online/gm/onlineCommands.ts:8 | Make selected tokens GM tokens |
| `onlineGm.command.stop` | online/gm/onlineCommands.ts:9 | Stop online table |
| `onlineGm.end.replaced` | online/gm/tableEnd.ts:26 | Another Obsidian took over the online table. |
| `onlineGm.end.noAccess` | online/gm/tableEnd.ts:27 | The online table was closed. {reason} |
| `onlineGm.end.superseded` | online/gm/tableEnd.ts:28 | The online table was closed. This account started another table. |
| `onlineGm.end.refused` | online/gm/tableEnd.ts:30 | The server closed the online table. |
| `onlineGm.end.closing` | online/gm/tableEnd.ts:42 | This table closes on {when}. Your account’s access to online play ended. |
| `onlineGm.lost.closed` | online/gm/tableEvents.ts:24 | The shared map was closed. Players wait until it is open again. |
| `onlineGm.lost.unpresented` | online/gm/tableEvents.ts:26 | Atlas presents no map. Players online wait until you show a map on the player view. |
| `onlineGm.start.noServer` | online/gm/tableStart.ts:32 | Set the online server address in Atlas settings first. |
| `onlineGm.start.noHostKey` | online/gm/tableStart.ts:35 | Set the host key in Atlas settings first. |
| `onlineGm.start.noMapTab` | online/gm/tableStart.ts:40 | Open an Atlas map tab first. |
| `onlineGm.start.signIn` | online/gm/tableStart.ts:43 | Sign in to host first. |
| `onlineGm.start.otherLink` | online/gm/tableStart.ts:53 | The server could not open this campaign's link. Try again later. |
| `onlineGm.share.noPlayerView` | online/gm/OnlineControl.ts:167 | Atlas cannot show this map on the player view. |
| `onlineGm.link.copied` | online/gm/OnlineFeature.ts:224 | Join link copied. |
| `onlineGm.link.copyFailed` | online/gm/OnlineFeature.ts:224 | The link could not be copied. |
| `onlineGm.tokens` | online/gm/OnlineFeature.ts:48 | {count} tokens |
| `onlineGm.mark.selectFirst` | online/gm/OnlineFeature.ts:345 | Select tokens on the map first. |
| `onlineGm.mark.player` | online/gm/OnlineFeature.ts:346 | Player tokens: {tokens}. Assign each to a player in the online panel. |
| `onlineGm.mark.gm` | online/gm/OnlineFeature.ts:346 | {tokens} now belong to the GM. |
| `onlineGm.scene.noImage` | online/gm/SceneShare.ts:284 | Atlas Online cannot send this scene's map image. |
| `onlineGm.scene.noLighting` | online/gm/atlasLighting.ts:119 | Atlas Online cannot read this scene's lighting, so players see nothing of it. |
| `onlineGm.found.openFailed` | online/gm/OnlineFeature.ts:190 | Could not open the found note |

### plugin

| Key | Where | English |
|---|---|---|
| `onlineGm.needsObsidian` | plugin/onlinePlay.ts:43 | Online play needs Obsidian {version} or newer. |

### gm/image

| Key | Where | English |
|---|---|---|
| `onlineGm.image.shown` | online/gm/image/imageTakeover.ts:6 | Image shown to players. |
| `onlineGm.image.hidden` | online/gm/image/imageTakeover.ts:7 | Image hidden from players. |
| `onlineGm.image.tooLarge` | online/gm/image/imageTakeover.ts:9 | This image is too large to show online. |
| `onlineGm.image.unreadable` | online/gm/image/imageTakeover.ts:10 | This image cannot be shown online. |

### gm/book

| Key | Where | English |
|---|---|---|
| `onlineGm.worldMap.missing` | online/gm/book/worldMap.ts:26 | Atlas Online cannot send the world map: its image file is missing. |
| `onlineGm.worldMap.tooLarge` | online/gm/book/worldMap.ts:27 | Atlas Online cannot send the world map: its image is larger than 64 MB. |
| `onlineGm.worldMap.unreadable` | online/gm/book/worldMap.ts:28 | Atlas Online cannot send the world map: its image is not a PNG, JPEG, WebP, GIF or AVIF that players can open. |

### gm/dock

| Key | Where | English |
|---|---|---|
| `onlineDock.intro` | online/gm/dock/accountMenu.ts:40 | Players see this map in their browsers and move their own tokens. |
| `onlineDock.title.play` | online/gm/dock/Dock.ts:227, online/gm/dock/accountMenu.ts:46 | Online play |
| `onlineDock.title.table` | online/gm/dock/Dock.ts:227, online/gm/dock/OnlinePanel.ts:41 | Online table |
| `onlineDock.update` | online/gm/dock/accountMenu.ts:82, online/gm/dock/closingRow.ts:30 | Update |
| `onlineDock.starting` | online/gm/dock/accountMenu.ts:87, online/gm/dock/panelModel.ts:250 | Starting… |
| `onlineDock.startTable` | online/gm/dock/accountMenu.ts:87 | Start online table |
| `onlineDock.signInToHost` | online/gm/dock/accountMenu.ts:99, online/gm/dock/accountMenu.ts:107 | Sign in to host |
| `onlineDock.opening` | online/gm/dock/accountMenu.ts:112 | Opening your browser… |
| `onlineDock.approveCode` | online/gm/dock/accountMenu.ts:114 | Approve this code in your browser. Atlas waits here. |
| `onlineDock.approveCodeLabel` | online/gm/dock/accountMenu.ts:115 | Code {code} |
| `onlineDock.openAgain` | online/gm/dock/accountMenu.ts:118 | Open again |
| `onlineDock.setHostKey` | online/gm/dock/accountMenu.ts:128 | Set the host key in Atlas settings. |
| `onlineDock.unaffected` | online/gm/dock/accountMenu.ts:134 | Running tables are unaffected. |
| `onlineDock.tryAgain` | online/gm/dock/accountMenu.ts:135 | Try again |
| `onlineDock.noPlayers` | online/gm/dock/campaignPicker.ts:48 | No players yet |
| `onlineDock.players` | online/gm/dock/campaignPicker.ts:49, online/gm/dock/panelModel.ts:233 | {count} players |
| `onlineDock.campaign.search` | online/gm/dock/campaignPicker.ts:125 | Search campaigns |
| `onlineDock.campaign.label` | online/gm/dock/campaignPicker.ts:141 | Campaign |
| `onlineDock.campaign.reading` | online/gm/dock/campaignPicker.ts:145 | Reading your campaigns… |
| `onlineDock.campaign.empty` | online/gm/dock/campaignPicker.ts:149 | A table plays a campaign: its players come back with their own codes. Make one in the Atlas dashboard. |
| `onlineDock.campaign.openDashboard` | online/gm/dock/campaignPicker.ts:150 | Open dashboard |
| `onlineDock.campaign.none` | online/gm/dock/campaignPicker.ts:162 | No campaign by that name |
| `onlineDock.accountPage` | online/gm/dock/closingRow.ts:22 | Account page |
| `onlineDock.qrCode` | online/gm/dock/controls.ts:74 | QR code |
| `onlineDock.copyLink` | online/gm/dock/controls.ts:83 | Copy invite link |
| `onlineDock.linkCopied` | online/gm/dock/controls.ts:83 | Link copied |
| `onlineDock.linkOptions` | online/gm/dock/controls.ts:87 | Link options |
| `onlineDock.more` | online/gm/dock/controls.ts:101 | More |
| `onlineDock.stopTable` | online/gm/dock/OnlinePanel.ts:116, online/gm/dock/controls.ts:105 | Stop table |
| `onlineDock.feedback.sending` | online/gm/dock/feedbackForm.ts:29 | Sending… |
| `onlineDock.feedback.sent` | online/gm/dock/feedbackForm.ts:30 | Thank you. Your feedback was sent. |
| `onlineDock.feedback.busy` | online/gm/dock/feedbackForm.ts:31 | Too much feedback right now. Try again in a minute. |
| `onlineDock.feedback.failed` | online/gm/dock/feedbackForm.ts:32 | It could not be sent. Check the server in the settings. |
| `onlineDock.feedback.title` | online/gm/dock/OnlinePanel.ts:113, online/gm/dock/feedbackForm.ts:42 | Send feedback |
| `onlineDock.feedback.close` | online/gm/dock/OnlinePanel.ts:113 | Close feedback |
| `onlineDock.feedback.placeholder` | online/gm/dock/feedbackForm.ts:45 | What went wrong, or what would help? |
| `onlineDock.feedback.label` | online/gm/dock/feedbackForm.ts:45 | Feedback |
| `onlineDock.feedback.diagnostics` | online/gm/dock/feedbackForm.ts:55 | Include diagnostics |
| `onlineDock.feedback.send` | online/gm/dock/feedbackForm.ts:59 | Send |
| `onlineDock.feedback.autoReports` | online/gm/dock/feedbackForm.ts:62 | Send error reports automatically |
| `onlineDock.feedback.noteDiagnostics` | online/gm/dock/feedbackForm.ts:56 | Sends your message and diagnostics (app version, browser or Obsidian version, system, recent error codes, connection quality) to the Atlas team. No names and nothing from your game. Kept for {days} days. |
| `onlineDock.feedback.noteMessage` | online/gm/dock/feedbackForm.ts:56 | Sends only your message to the Atlas team. No names and nothing from your game. Kept for {days} days. |
| `onlineDock.newCode` | online/gm/dock/gateRows.ts:45, online/gm/dock/gateRows.ts:60 | New code |
| `onlineDock.requireCode` | online/gm/dock/gateRows.ts:46 | Require code |
| `onlineDock.askToJoin` | online/gm/dock/gateRows.ts:47 | Ask before players join |
| `onlineDock.code` | online/gm/dock/gateRows.ts:68, online/gm/dock/prompts.ts:181 | Code {code} |
| `onlineDock.codeCopied` | online/gm/dock/gateRows.ts:68, online/gm/dock/playerCodes.ts:15 | Code copied |
| `onlineDock.codeCopyFailed` | online/gm/dock/playerCodes.ts:15 | The code could not be copied. |
| `onlineDock.imageShown` | online/gm/dock/imageRow.ts:17 | Image shown |
| `onlineDock.hide` | online/gm/dock/imageRow.ts:18 | Hide |
| `onlineDock.qr.codeOfLink` | online/gm/dock/inviteQr.ts:36 | QR code of the invite link |
| `onlineDock.qr.invite` | online/gm/dock/inviteQr.ts:155 | Invite |
| `onlineDock.qr.copyImage` | online/gm/dock/inviteQr.ts:159 | Copy image |
| `onlineDock.qr.codeLabel` | online/gm/dock/inviteQr.ts:179 | Code  |
| `onlineDock.qr.copyFailed` | online/gm/dock/inviteQr.ts:195 | The image could not be copied. |
| `onlineDock.qr.copied` | online/gm/dock/inviteQr.ts:205 | Image copied |
| `onlineDock.knock.label` | online/gm/dock/knockStack.ts:45 | {name} wants to join |
| `onlineDock.knock.full` | online/gm/dock/knockStack.ts:47 | : table full |
| `onlineDock.knock.wants` | online/gm/dock/knockStack.ts:47 |  wants to join |
| `onlineDock.knock.decline` | online/gm/dock/knockStack.ts:51, online/gm/dock/knockStack.ts:74 | Decline |
| `onlineDock.knock.admit` | online/gm/dock/knockStack.ts:52 | Admit |
| `onlineDock.knock.region` | online/gm/dock/knockStack.ts:159 | Players asking the GM |
| `onlineDock.rest.nothing` | online/gm/dock/knockStack.ts:60 | Nothing to restore |
| `onlineDock.rest.label` | online/gm/dock/knockStack.ts:67 | {character} asks for a {button} |
| `onlineDock.rest.asks` | online/gm/dock/knockStack.ts:69 |  asks for a {button} |
| `onlineDock.rest.approve` | online/gm/dock/knockStack.ts:75 | Approve |
| `onlineDock.seatsNote` | online/gm/dock/panelModel.ts:230 | Table full · {seats} |
| `onlineDock.seats` | online/gm/dock/panelModel.ts:230 | {count} seats |
| `onlineDock.tooltipWaiting` | online/gm/dock/panelModel.ts:242 | Online table · waiting for players |
| `onlineDock.tooltipPlayers` | online/gm/dock/panelModel.ts:242 | Online table · {players} |
| `onlineDock.status.connecting` | online/gm/dock/panelModel.ts:251 | Connecting… |
| `onlineDock.status.reconnecting` | online/gm/dock/panelModel.ts:252 | Reconnecting… |
| `onlineDock.status.waiting` | online/gm/dock/panelModel.ts:253 | Online, waiting for players |
| `onlineDock.status.online` | online/gm/dock/panelModel.ts:253 | Online · {players} |
| `onlineDock.status.refused` | online/gm/dock/panelModel.ts:254 | The server closed the table |
| `onlineDock.status.notStarted` | online/gm/dock/panelModel.ts:255 | Not started |
| `onlineDock.rename.label` | online/gm/dock/OnlinePanel.ts:88 | Rename {name} |
| `onlineDock.rename.menu` | online/gm/dock/playerList.ts:91 | Rename… |
| `onlineDock.removePlayer.label` | online/gm/dock/OnlinePanel.ts:92 | Remove {name} from the campaign |
| `onlineDock.removePlayer.text` | online/gm/dock/OnlinePanel.ts:92 | Remove {name} from the campaign? |
| `onlineDock.stop.label` | online/gm/dock/OnlinePanel.ts:116 | Stop the table |
| `onlineDock.stop.text` | online/gm/dock/OnlinePanel.ts:116 | Stop for everyone? |
| `onlineDock.hiddenFromPlayers` | online/gm/dock/playerList.ts:50 | Hidden from players |
| `onlineDock.releaseAll` | online/gm/dock/playerList.ts:60, online/gm/dock/playerList.ts:62 | Release all |
| `onlineDock.release.one` | online/gm/dock/playerList.ts:61 | Release {label} |
| `onlineDock.release.menu` | online/gm/dock/playerList.ts:118 | Release |
| `onlineDock.presence.online` | online/gm/dock/playerList.ts:44 | Online |
| `onlineDock.presence.away` | online/gm/dock/playerList.ts:44 | Away |
| `onlineDock.presence.onlinePlays` | online/gm/dock/playerList.ts:45 | Online, plays {label} |
| `onlineDock.presence.awayPlays` | online/gm/dock/playerList.ts:45 | Away, plays {label} |
| `onlineDock.playerOptions` | online/gm/dock/playerList.ts:82 | {name}: options |
| `onlineDock.assignSelected` | online/gm/dock/playerList.ts:87 | Assign selected tokens here |
| `onlineDock.copyCode` | online/gm/dock/playerList.ts:89 | Copy code |
| `onlineDock.removeFromTable` | online/gm/dock/playerList.ts:92 | Remove from table |
| `onlineDock.removeFromCampaign` | online/gm/dock/playerList.ts:93 | Remove from campaign |
| `onlineDock.awayName` | online/gm/dock/playerList.ts:99 | {name} (away) |
| `onlineDock.owner.free` | online/gm/dock/playerList.ts:110 | {label}: free, assign to a player |
| `onlineDock.owner.playedBy` | online/gm/dock/playerList.ts:110 | {label}: played by {name} |
| `onlineDock.assign` | online/gm/dock/playerList.ts:113, online/gm/dock/selectionBar.ts:38 | Assign |
| `onlineDock.notPlayerToken` | online/gm/dock/playerList.ts:119 | Not a player token |
| `onlineDock.notAssigned` | online/gm/dock/playerList.ts:142 | Not assigned |
| `onlineDock.addPlayer.label` | online/gm/dock/prompts.ts:81 | Add a player |
| `onlineDock.addPlayer.confirm` | online/gm/dock/prompts.ts:81 | Add |
| `onlineDock.addPlayer.button` | online/gm/dock/prompts.ts:87 | Add player |
| `onlineDock.newLink` | online/gm/dock/prompts.ts:92, online/gm/dock/prompts.ts:93 | New link |
| `onlineDock.newLinkText` | online/gm/dock/prompts.ts:92 | The old link stops working. Players need the new one. |
| `onlineDock.nameLabel` | online/gm/dock/prompts.ts:154 | Name |
| `onlineDock.newPlayerCode` | online/gm/dock/prompts.ts:176 | Code of the new player |
| `onlineDock.joinsWith` | online/gm/dock/prompts.ts:179 |  joins with |
| `onlineDock.selected` | online/gm/dock/selectionBar.ts:20 | {count} selected |
| `onlineDock.shareMap` | online/gm/dock/ConnectionMenu.ts:61, online/gm/dock/selectionBar.ts:30 | Show this map to players |
| `onlineDock.makePlayerTokens` | online/gm/dock/selectionBar.ts:35 | Make player tokens |
| `onlineDock.unmark` | online/gm/dock/selectionBar.ts:36 | Unmark |

### tableLog

| Key | Where | English |
|---|---|---|
| `onlineLog.author.you` | online/tableLog/logAuthors.ts:61 | You |
| `onlineLog.author.youLower` | online/tableLog/ChatRow.tsx:84, online/tableLog/FoundRow.tsx:26 | you |
| `onlineLog.author.someone` | online/tableLog/audience.ts:8 | someone |
| `onlineLog.edited` | online/tableLog/ChatRow.tsx:48 | (edited) |
| `onlineLog.whisperTo` | online/tableLog/Composer.tsx:153, online/tableLog/LogList.tsx:115 | Whisper to {names} |
| `onlineLog.speakAs` | online/tableLog/Composer.tsx:153 | Speak as {name} |
| `onlineLog.replyInThread` | online/tableLog/Composer.tsx:153 | Reply in thread |
| `onlineLog.messageTable` | online/tableLog/Composer.tsx:153 | Message the table |
| `onlineLog.cancelReply` | online/tableLog/Composer.tsx:161 | Cancel reply |
| `onlineLog.to` | online/tableLog/Composer.tsx:164 | To {names} |
| `onlineLog.stopWhispering` | online/tableLog/Composer.tsx:164 | Stop whispering |
| `onlineLog.message` | online/tableLog/Composer.tsx:177 | Message |
| `onlineLog.commandsAndDice` | online/tableLog/Composer.tsx:185 | Commands and dice |
| `onlineLog.send` | online/tableLog/Composer.tsx:188 | Send |
| `onlineLog.speakingAsSelf` | online/tableLog/ComposerChoices.tsx:33 | Speaking as yourself |
| `onlineLog.speakingAs` | online/tableLog/ComposerChoices.tsx:33 | Speaking as {name} |
| `onlineLog.selfOption` | online/tableLog/ComposerChoices.tsx:43 | {name} (you) |
| `onlineLog.rollMode` | online/tableLog/ComposerChoices.tsx:63 | Roll mode: {mode} |
| `onlineLog.whisperingTo` | online/tableLog/composerReply.ts:21 | Whispering to {names} |
| `onlineLog.replyingInThread` | online/tableLog/composerReply.ts:22 | Replying in thread |
| `onlineLog.replyingToSelf` | online/tableLog/composerReply.ts:23 | Replying to yourself |
| `onlineLog.replyingTo` | online/tableLog/composerReply.ts:23 | Replying to {name} |
| `onlineLog.editMessage` | online/tableLog/EditField.tsx:40 | Edit message |
| `onlineLog.editHint` | online/tableLog/EditField.tsx:44 | Enter saves, Escape cancels |
| `onlineLog.found.read` | online/tableLog/FoundRow.tsx:35 | Read |
| `onlineLog.found.by` | online/tableLog/FoundRow.tsx:46 | Found by {finder} |
| `onlineLog.found.readTitle` | online/tableLog/FoundRow.tsx:51 | Read {title} |
| `onlineLog.help.advantage` | online/tableLog/HelpCard.tsx:9 | Advantage: keep the highest |
| `onlineLog.help.keepThree` | online/tableLog/HelpCard.tsx:10 | Keep the three highest |
| `onlineLog.help.reroll` | online/tableLog/HelpCard.tsx:11 | Reroll a 1, anything below 2 once, 1s until none is left |
| `onlineLog.help.explode` | online/tableLog/HelpCard.tsx:12 | Roll again on the highest face, once only, on 9 or more |
| `onlineLog.help.explodeShort` | online/tableLog/HelpCard.tsx:13 | Roll again once, up to three times, without end |
| `onlineLog.help.successes` | online/tableLog/HelpCard.tsx:14 | Count successes from 5 |
| `onlineLog.help.failures` | online/tableLog/HelpCard.tsx:15 | Count failures up to 1 |
| `onlineLog.help.percentile` | online/tableLog/HelpCard.tsx:16 | Percentile and Fate dice |
| `onlineLog.help.name` | online/tableLog/HelpCard.tsx:17 | Name a part of the roll |
| `onlineLog.help.arithmetic` | online/tableLog/HelpCard.tsx:18 | Arithmetic |
| `onlineLog.help.inline` | online/tableLog/HelpCard.tsx:19 | In a message: rolled as it is sent |
| `onlineLog.help.inlineButton` | online/tableLog/HelpCard.tsx:20 | In a message: a button anyone can roll |
| `onlineLog.help.describe` | online/tableLog/HelpCard.tsx:21 | Describe the roll after # |
| `onlineLog.help.label` | online/tableLog/HelpCard.tsx:29 | Chat help |
| `onlineLog.help.commands` | online/tableLog/HelpCard.tsx:31 | Commands |
| `onlineLog.help.close` | online/tableLog/HelpCard.tsx:32 | Close help |
| `onlineLog.help.dice` | online/tableLog/HelpCard.tsx:44, online/tableLog/RollRow.tsx:83 | Dice |
| `onlineLog.cmd.r` | online/tableLog/commandList.ts:17 | Roll dice in your roll mode |
| `onlineLog.cmd.pr` | online/tableLog/commandList.ts:18 | Roll for everyone to see |
| `onlineLog.cmd.gmr` | online/tableLog/commandList.ts:19 | Roll for yourself and the GM |
| `onlineLog.cmd.br` | online/tableLog/commandList.ts:20 | Roll blind: only the GM sees the result |
| `onlineLog.cmd.sr` | online/tableLog/commandList.ts:21 | Roll for yourself alone |
| `onlineLog.cmd.w` | online/tableLog/commandList.ts:22 | Whisper to someone |
| `onlineLog.cmd.gm` | online/tableLog/commandList.ts:23 | Whisper to the GM |
| `onlineLog.cmd.players` | online/tableLog/commandList.ts:24 | Whisper to every player |
| `onlineLog.cmd.reply` | online/tableLog/commandList.ts:25 | Whisper back to your last whisper |
| `onlineLog.cmd.ic` | online/tableLog/commandList.ts:26 | Say it in character, as your token |
| `onlineLog.cmd.ooc` | online/tableLog/commandList.ts:27 | Say it out of character, as yourself |
| `onlineLog.cmd.em` | online/tableLog/commandList.ts:28 | Describe what you do |
| `onlineLog.cmd.help` | online/tableLog/commandList.ts:29 | Show the commands and the dice notation |
| `onlineLog.error.tooManyRolls` | online/tableLog/chatCommands.ts:39 | A message holds at most {max} rolls, and a roll button takes /r, /gmr, /br or /sr. |
| `onlineLog.error.writeDice` | online/tableLog/chatCommands.ts:54 | Write the dice after /{spelling}, like /{spelling} 1d20+5. |
| `onlineLog.error.formulaLong` | online/tableLog/chatCommands.ts:55 | That formula is too long. |
| `onlineLog.error.flavorLong` | online/tableLog/chatCommands.ts:57 | A roll's description holds at most {max} characters. |
| `onlineLog.error.nobody` | online/tableLog/chatCommands.ts:68 | Nobody at the table is called {name}. |
| `onlineLog.error.several` | online/tableLog/chatCommands.ts:68 | More than one person at the table is called {name}. |
| `onlineLog.error.whisperSelf` | online/tableLog/chatCommands.ts:86 | You cannot whisper to yourself. |
| `onlineLog.error.closeNames` | online/tableLog/chatCommands.ts:92 | Close the list of names with ], like /w [Kara, GM] Hello. |
| `onlineLog.error.writeName` | online/tableLog/chatCommands.ts:93 | Write a name after /{spelling}, like /{spelling} Kara Hello. |
| `onlineLog.error.spaceNames` | online/tableLog/chatCommands.ts:97 | {problem} Names with spaces go in brackets: /{spelling} [Kara Thorn] Hello. |
| `onlineLog.error.youAreGm` | online/tableLog/chatCommands.ts:110 | You are the GM. |
| `onlineLog.error.noPlayers` | online/tableLog/chatCommands.ts:113 | No players are at the table. |
| `onlineLog.error.nobodyWhispered` | online/tableLog/chatCommands.ts:116 | Nobody has whispered to you yet. |
| `onlineLog.error.chooseToken` | online/tableLog/chatCommands.ts:119 | Choose a token to speak as first. |
| `onlineLog.error.writeIc` | online/tableLog/chatCommands.ts:120 | Write what to say after /ic. |
| `onlineLog.error.writeOoc` | online/tableLog/chatCommands.ts:124 | Write what to say after /ooc. |
| `onlineLog.error.writeEm` | online/tableLog/chatCommands.ts:126 | Write what you do after /{spelling}. |
| `onlineLog.error.noCommand` | online/tableLog/chatCommands.ts:147 | There is no command /{spelling}. Type /help to see them all. |
| `onlineLog.error.whisperGone` | online/tableLog/chatCommands.ts:160 | Everyone in that whisper has left the table. |
| `onlineLog.log.title` | online/tableLog/LogHeader.tsx:33 | Table log |
| `onlineLog.log.clearAsk` | online/tableLog/LogHeader.tsx:36 | Clear the log for everyone? |
| `onlineLog.log.clear` | online/tableLog/LogHeader.tsx:37 | Clear |
| `onlineLog.keep` | online/tableLog/LogHeader.tsx:38, online/tableLog/RowTools.tsx:115 | Keep |
| `onlineLog.log.clearTip` | online/tableLog/LogHeader.tsx:43 | Clear the log |
| `onlineLog.log.unpin` | online/tableLog/LogHeader.tsx:47 | Unpin |
| `onlineLog.log.pin` | online/tableLog/LogHeader.tsx:47 | Pin |
| `onlineLog.log.jump` | online/tableLog/LogList.tsx:56 | Jump to latest |
| `onlineLog.log.newMessages` | online/tableLog/LogList.tsx:56 | {count} new messages |
| `onlineLog.log.empty` | online/tableLog/LogList.tsx:98 | Nothing yet. Say hello, or roll some dice. |
| `onlineLog.log.threadEmpty` | online/tableLog/LogList.tsx:133 | No replies yet. Start the thread. |
| `onlineLog.log.open` | online/tableLog/LogUnreadTab.tsx:17 | Open the table log |
| `onlineLog.log.unread` | online/tableLog/LogUnreadTab.tsx:21 | Table log, {count} new |
| `onlineLog.messageDeleted` | online/tableLog/ReplyQuote.tsx:27 | Message deleted |
| `onlineLog.rest.nothing` | online/tableLog/RestRow.tsx:44 | Nothing to restore. |
| `onlineLog.rest.notChanged` | online/tableLog/RestRow.tsx:46 | Not changed: {names} |
| `onlineLog.mode.public` | online/tableLog/rollModes.ts:15 | Public roll |
| `onlineLog.mode.gm` | online/tableLog/rollModes.ts:16 | GM only |
| `onlineLog.mode.blindChoice` | online/tableLog/rollModes.ts:17 | Blind (only the GM sees the result) |
| `onlineLog.mode.blind` | online/tableLog/rollModes.ts:17 | Blind |
| `onlineLog.mode.selfChoice` | online/tableLog/rollModes.ts:18 | Only me |
| `onlineLog.mode.selfBadge` | online/tableLog/rollModes.ts:18 | Only you |
| `onlineLog.mode.whisper` | online/tableLog/RollRow.tsx:57 | Whisper |
| `onlineLog.roll.by` | online/tableLog/RollRow.tsx:33 | {roller} rolled |
| `onlineLog.roll.byToken` | online/tableLog/RollRow.tsx:33 | {token} ({roller}) rolled |
| `onlineLog.roll.for` | online/tableLog/RollRow.tsx:71 | for {label} |
| `onlineLog.roll.onlyYou` | online/tableLog/RollRow.tsx:86 | Only you see this roll |
| `onlineLog.reaction.thumbsUp` | online/tableLog/RowTools.tsx:14 | Thumbs up |
| `onlineLog.reaction.thumbsUpOff` | online/tableLog/RowTools.tsx:14 | Remove thumbs up |
| `onlineLog.reaction.heart` | online/tableLog/RowTools.tsx:15 | Heart |
| `onlineLog.reaction.heartOff` | online/tableLog/RowTools.tsx:15 | Remove heart |
| `onlineLog.reaction.laugh` | online/tableLog/RowTools.tsx:16 | Laugh |
| `onlineLog.reaction.laughOff` | online/tableLog/RowTools.tsx:16 | Remove laugh |
| `onlineLog.reaction.wow` | online/tableLog/RowTools.tsx:17 | Wow |
| `onlineLog.reaction.wowOff` | online/tableLog/RowTools.tsx:17 | Remove wow |
| `onlineLog.reaction.sad` | online/tableLog/RowTools.tsx:18 | Sad |
| `onlineLog.reaction.sadOff` | online/tableLog/RowTools.tsx:18 | Remove sad |
| `onlineLog.reaction.thumbsDown` | online/tableLog/RowTools.tsx:19 | Thumbs down |
| `onlineLog.reaction.thumbsDownOff` | online/tableLog/RowTools.tsx:19 | Remove thumbs down |
| `onlineLog.reaction.fewer` | online/tableLog/RowTools.tsx:101 | Fewer reactions |
| `onlineLog.reaction.more` | online/tableLog/RowTools.tsx:101 | More reactions |
| `onlineLog.reply` | online/tableLog/RowTools.tsx:105 | Reply |
| `onlineLog.deleteAsk` | online/tableLog/RowTools.tsx:113 | Delete this message? |
| `onlineLog.secret.blind` | online/tableLog/SecretRow.tsx:15 | You rolled blind. Only the GM sees the result. |
| `onlineLog.secret.self` | online/tableLog/SecretRow.tsx:15 | You rolled privately. |
| `onlineLog.secret.other` | online/tableLog/SecretRow.tsx:18 | {by} rolled privately |
| `onlineLog.shown.image` | online/tableLog/ShownRows.tsx:27 | {name} showed an image |
| `onlineLog.shown.loot` | online/tableLog/ShownRows.tsx:27 | {name} handed out |
| `onlineLog.shown.open` | online/tableLog/ShownRows.tsx:54 | Open the image |
| `onlineLog.suggestions` | online/tableLog/SuggestionList.tsx:44 | Suggestions |
| `onlineLog.thread.back` | online/tableLog/ThreadBar.tsx:22 | Back to the log |
| `onlineLog.thread.backUnseen` | online/tableLog/ThreadBar.tsx:22 | Back to the log, {count} new |
| `onlineLog.thread.title` | online/tableLog/ThreadBar.tsx:25 | Thread |
| `onlineLog.thread.replies` | online/tableLog/logThreads.ts:84 | {count} replies |
| `onlineLog.offline` | online/tableLog/TableLogPanel.tsx:18 | You cannot write right now. |
| `onlineLog.time.now` | online/tableLog/logTime.ts:26 | just now |
| `onlineLog.time.minutes` | online/tableLog/logTime.ts:27 | {count}m ago |
| `onlineLog.time.hours` | online/tableLog/logTime.ts:28 | {count}h ago |
| `onlineLog.time.today` | online/tableLog/logTime.ts:34 | Today |
| `onlineLog.time.yesterday` | online/tableLog/logTime.ts:36 | Yesterday |
| `onlineLog.refusal.rate` | online/tableLog/useRefusalNotice.ts:10 | You are sending too fast. Wait a moment. |
| `onlineLog.refusal.text` | online/tableLog/useRefusalNotice.ts:11 | That message cannot be sent. |
| `onlineLog.refusal.gone` | online/tableLog/useRefusalNotice.ts:12 | That message is gone. |
| `onlineLog.refusal.whisper` | online/tableLog/useRefusalNotice.ts:13 | Nobody at the table has that name. |
| `onlineLog.refusal.speaker` | online/tableLog/useRefusalNotice.ts:14 | You cannot speak as that token. |
| `onlineLog.refusal.roll` | online/tableLog/useRefusalNotice.ts:15 | A roll in that message does not work. Check the dice, or keep the rolls as they were. |

### gm/log

| Key | Where | English |
|---|---|---|
| `onlineLog.author.gm` | online/gm/log/gmSpeakers.ts:24, online/tableLog/audience.ts:7 | GM |
| `onlineLog.mountOffline` | online/gm/log/TableLogMount.ts:11 | The table is offline. You can write again once it is back. |

## Kept English

What stays English, and why (the categories of `i18n-zh-gap.md` "Deliberately left English", plus the online-specific ones):

- **Sent over the wire to players, or stored in the vault or plugin data.** These reach other people's screens in the player's language or sit in saved files, so they must not depend on the GM's language:
  - Book titles and sheet text sent to players: `gm/book/BookShare.ts:43`, `gm/book/bookRests.ts:11`, `gm/book/characterRests.ts:24` (`Unnamed character`), `gm/book/bookItem.ts:11` (`Unnamed item`), `gm/book/worldMapLevels.ts:8` (`Map`), `gm/book/abilityComponents.ts:113,162,163,171` (`Abilities`, `The creature`, `knows the following spells:`, `Spells`).
  - Log entry text kept in the table log and sent to players: `gm/log/restEntry.ts:11` (`Unnamed`), `gm/log/logChat.ts:63` (`An image`, a reply preview that travels with the entry).
  - Protocol strings, log entry kinds, close codes, ids, command ids (`ONLINE_COMMANDS[].id`), CSS classes, `data-*` keys, icon names, saved names.
- **Typed tokens of the chat commands.** `/r`, `/w`, `/gm`, the dice notation, and the `GM` name offered after `/w` stay English because the parser matches them (`tableLog/chatCommands.ts` `resolveName`, `tableLog/commandSuggestions.ts:45`). Their usage examples (`tableLog/commandList.ts` `usage`) and the notation terms in the help card stay too; only the descriptions are translated.
- **Thrown errors and console or log text.** `gm/account/tokenStore.ts:58,63` (the error thrown where secret storage is missing), `gm/dock/qrImage.ts:50`, `gm/companionDiagnostics.ts:110` (`console.warn` line), the `runInBackground` context `Opening ${link}` (`gm/OnlineFeature.ts:190`; its user message is translated), `gm/account/obsidianHttp.ts:26`.
- **Diagnostics sent to the server.** `gm/companionDiagnostics.ts:125` (`Obsidian x`, `macOS`, `Windows`, `Linux`, `Other`), `gm/book/statblockGate.ts:29` (`problem`, only compared with `null`).
- **Product and key names.** Atlas, Atlas Online, Obsidian, Enter, Esc, `https://play.example.com`.
- **The issue report and game content.** Not touched here (none in scope).

Total wired keys: 352.
