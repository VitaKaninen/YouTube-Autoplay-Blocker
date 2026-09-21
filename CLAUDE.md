# YouTube Autoplay Blocker

Tampermonkey userscript. Shared rules for every script in this folder live in `../CLAUDE.md`
(version bumps, commit+push, comment budget, load-order of `const`s above `cfg`).

## How it works
- `installPlayGate()` injects `GATE_SRC` as a `<script>` so it runs in page context on every
  browser/sandbox. It replaces `HTMLMediaElement.prototype.play`; a call on a video inside
  `#movie_player` with no intent returns a rejected `NotAllowedError` promise (what Firefox's own
  block returns, which YouTube handles by showing the Play button) and dispatches `ytab-refused`.
  Pausing from the `play` event instead lets a frame or two render when data is already buffered
  (ctrl-click background tabs, discarded-tab restores); that listener remains only as a fallback.
  Sandbox <-> page channel is `data-ytab-intent` on `<html>` (`setIntent()` is its only writer);
  `data-ytab-gate-installed` is the page-side read-back.
  YouTube enforces Trusted Types: `script.textContent = src` throws, so the catch creates a
  policy (`trustedTypes.createPolicy`, allowed by YouTube's CSP) and retries.
  v0.6-0.7 patched `unsafeWindow.HTMLMediaElement.prototype` from the sandbox; under Firefox
  Xrays that lands as an expando the page never sees while the sandbox read-back passes - which
  is why background-tab autoplay still slipped through on LibreWolf. Do not go back to it.
- Intent is set by capture `mousedown` on `INTENT_SELECTOR` (player, thumbnails, watch/shorts
  links) or capture `keydown` of Space / k / MediaPlayPause outside text fields.
- Intent is cleared in `syncVideo()` whenever the `?v=` / `/shorts/` id changes or the `<video>`
  element is replaced; driven by a MutationObserver on `documentElement` plus `yt-navigate-finish`.
  YouTube usually reuses the same `<video>` across SPA navigation, so the id check is the one
  that normally fires.
- While a requested play waits for data (`isQueued()`: intent set, `!paused`, readyState<3)
  YouTube is in `unstarted-mode` and treats EVERY further click / play key as another play
  request - it never pauses (measured: 3 clicks, 3 `play()` calls). So `cancelQueued()` takes
  that click on `window` capture: clears intent, `pause()`s, swallows mousedown/mouseup/click
  (keydown for keys) so YouTube never sees it. When data then arrives YouTube does not re-request
  play; the next click plays normally. YouTube's own spinner stays up after a cancel, hence the
  "cancelled" badge state.
- `syncVideo()` fires twice on a full load (id known at document-start, `<video>` later); only
  the id change resets intent, the element change only hooks.

## Measured (Chromium pane, 2026-09-21)
- YouTube's play/pause button follows `playing`, not the `play()` request. A click at
  `readyState 0` flips `video.paused` within ~10 ms (a second click pauses again) but the button
  stays "Play" until data arrives (~350-700 ms). The badge ("queued" / "cancelled") is driven by
  `<video>` events plus `cancelQueued()`, never by click counting.
- play() gate verified in the pane (v0.6.0): one `refused play()` at 343 ms, no `play` event,
  `currentTime` stayed 0, player in `unstarted-mode`; a real click then played normally.
- Buffering continues while blocked: `loadstart -> canplay` took ~700-800 ms with or without the
  block. So blocking does not obviously delay readiness in Chromium; Firefox is unmeasured and is
  what the timing log is for.
- Menu commands use `{ id }` so `buildMenu()` replaces entries. `@noframes`: without it every
  YouTube iframe registers the same commands and a command runs once per frame.
- The timing log / console tracing (v0.2-0.8) was removed in v0.9.0 once the measurements below
  were in; re-add ad hoc (record per video id, flushed on first `playing`) if a new timing
  question comes up. Only two `console.warn`s remain: settings unreadable, gate not installed.

## Measured (LibreWolf, user's machine, 2026-09-21, 30 full loads of one video)
- `playing` median: LW autoplay-block + script 16.5 s, script only 16.5 s, neither 17.1 s.
  Neither blocker costs anything. The ~14 s from player-appears to `canplay` is LibreWolf
  itself (Chromium pane: ~0.7 s); 3 of 30 runs took ~3.7 s.
- Cause (bisected 2026-09-21): NoScript had doubleclick.net at its *Default* preset (no
  capability boxes, not blocked). One `videoplayback?...sabr=1` request returned 200 in 300 ms,
  then silence, then an HLS manifest fetch and playback at ~16 s - SABR stalled and fell back to
  HLS. Setting doubleclick.net to *Untrusted* -> ~3 s. Each NoScript change only takes effect
  after a browser restart (player caches the decision per session); that is what made the
  earlier WebGL / RFP / Troubleshoot-Mode results look inconsistent. WebGL and RFP were not it.
- With LW's setting on, Firefox rejects `play()` before any event: `firstAutoPlayMs` stays null.
- Pause-after-`play` showed a frame or two when data was already buffered (ctrl-click background
  tabs, Auto Tab Discard restores). v0.8.0 refuses the `play()` call from a page script; if it
  still slips through on LibreWolf, check the console for "play() gate not installed" first.

## Testing in the built-in browser pane
To hold the media at readyState 0 for as long as needed, wrap `window.fetch` and return a
never-settling promise for URLs matching `videoplayback` (keep the resolvers to release later);
YouTube fetches media with fetch, not XHR, in the pane. That is how the queued/cancel path was
verified (v0.7.0).
No Tampermonkey there: inject the script with `GM_*` shims on a results page and SPA-click into
a video (the instance survives). Injection after a full navigation lands ~3 s late, too late to
see the initial autoplay. `document.getElementById('movie_player').loadVideoById(id)` resets the
media to readyState 0 in place and reproduces the blocked-with-no-data state on demand.

## Provenance
Clean-room reimplementation of the *technique* (intent flag + pause-on-play + reset per video)
used by several MIT-licensed Greasyfork scripts. No code was copied; no attribution obligation.

## Settings
One JSON blob under GM key `settings`, toggled from the userscript menu. Only the badge toggle
remains (v0.10.0): "blocking enabled" duplicated Tampermonkey's own switch, "block first video on
page load" off allowed exactly the full-load autoplay the script exists to stop, "keyboard is
intent" off made Space/k unable to start a blocked video, "refuse play()" off was the v0.5
pause-after-play A/B route. Do not reintroduce them.
Test setting changes by reloading the page, not by reopening the menu.
