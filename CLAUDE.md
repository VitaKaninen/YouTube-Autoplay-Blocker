# YouTube Autoplay Blocker

Tampermonkey userscript. Shared rules for every script in this folder live in `../CLAUDE.md`
(version bumps, commit+push, comment budget, load-order of `const`s above `cfg`).

## How it works
- A `play` listener on `video.html5-main-video` calls `pause()` unless `userWantsPlay` is set.
- Intent is set by capture `mousedown` on `INTENT_SELECTOR` (player, thumbnails, watch/shorts
  links) or capture `keydown` of Space / k / MediaPlayPause outside text fields.
- Intent is cleared in `syncVideo()` whenever the `?v=` / `/shorts/` id changes or the `<video>`
  element is replaced; driven by a MutationObserver on `documentElement` plus `yt-navigate-finish`.
  YouTube usually reuses the same `<video>` across SPA navigation, so the id check is the one
  that normally fires.
- `firstVideo` distinguishes the page-load video (governed by `blockOnPageLoad`) from later ones.
- `syncVideo()` fires twice on a full load (id known at document-start, `<video>` later); only
  the id change resets intent / starts a timing record, the element change only hooks.

## Measured (Chromium pane, 2026-09-21)
- YouTube's play/pause button follows `playing`, not the `play()` request. A click at
  `readyState 0` flips `video.paused` to false within ~10 ms but the button stays "Play" until
  data arrives (~350-700 ms). The "queued" badge exists to fill that gap; it is driven by the
  `<video>` events (`play` with readyState<3 shows it, `playing`/`pause` hide it) so it is always
  true to the element state, including a second click that pauses.
- Buffering continues while blocked: `loadstart -> canplay` took ~700-800 ms with or without the
  block. So blocking does not obviously delay readiness in Chromium; Firefox is unmeasured and is
  what the timing log is for.
- Timing log: one record per video id, flushed on first `playing`; menu "Print timing log"
  gives `console.table` plus medians split by blocking on/off and full-load vs SPA.

## Testing in the built-in browser pane
No Tampermonkey there: inject the script with `GM_*` shims on a results page and SPA-click into
a video (the instance survives). Injection after a full navigation lands ~3 s late, too late to
see the initial autoplay. `document.getElementById('movie_player').loadVideoById(id)` resets the
media to readyState 0 in place and reproduces the blocked-with-no-data state on demand.

## Provenance
Clean-room reimplementation of the *technique* (intent flag + pause-on-play + reset per video)
used by several MIT-licensed Greasyfork scripts. No code was copied; no attribution obligation.

## Settings
Stored as one JSON blob under GM key `settings`; toggled from the userscript menu.
Test setting changes by reloading the page, not by reopening the menu.
