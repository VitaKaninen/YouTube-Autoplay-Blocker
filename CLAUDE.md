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

## Provenance
Clean-room reimplementation of the *technique* (intent flag + pause-on-play + reset per video)
used by several MIT-licensed Greasyfork scripts. No code was copied; no attribution obligation.

## Settings
Stored as one JSON blob under GM key `settings`; toggled from the userscript menu.
Test setting changes by reloading the page, not by reopening the menu.
