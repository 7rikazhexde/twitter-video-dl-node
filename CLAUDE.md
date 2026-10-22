# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Node.js CLI that downloads X (Twitter) videos as MP4 without API keys, by scraping a guest bearer token from X's web client and calling the internal GraphQL API. It is a port of the Python project [twitter-video-dl-for-sc](https://github.com/7rikazhexde/twitter-video-dl-for-sc); fixes for X-side changes (token scraping, GraphQL features/variables) usually originate there and should stay in sync with it.

## Commands

Run everything from the repository root (see "Path assumptions" below). Node.js and pnpm are pinned in `mise.toml` (not Volta/npm). Node must stay at a release that distrusts the compromised eMudhra emSign CA intermediates (22.23.4 / 24.22.1 / 26.12.1 or later; enforced via `engines` + `engineStrict`).

```bash
mise install && pnpm install
node twitter-video-dl-node <tweet_url> <file_name>   # file_name may be "" → output.mp4
pnpm test                                            # jest; all tests
pnpm exec jest -t "Test 3"                           # single test case by name
```

`pnpm-workspace.yaml` holds supply-chain settings: `minimumReleaseAge` (7 days), `trustPolicy: no-downgrade` (with `trustPolicyExclude` for verified exceptions), and `allowBuilds` (dependency install scripts are denied). If an install fails on one of these, investigate the package before adding an exception.

CI (`.github/workflows/ci.yml`) runs the same steps via `jdx/mise-action` on push/PR and weekly. Actions are pinned by commit SHA; Dependabot (`.github/dependabot.yml`, 7-day cooldown) updates both npm deps and the action SHAs. `main` is protected by a ruleset: changes (including version bumps) must go through a PR with the `test` and `dependency-review` checks passing; force pushes and deletion are blocked.

Tests are live integration tests: they hit x.com over the network and verify output with `ffprobe` (via `fluent-ffmpeg`), so `ffmpeg`/`ffprobe` must be installed on PATH. Each test has a 10s timeout.

## Architecture

- `twitter-video-dl-node.js` — yargs CLI entry; calls `download_video(url, file_name)`.
- `src/twitter_video_dl/twitter_video_dl.js` — all logic, exports only `download_video(tweet_url, output_file, output_folder_path = "./output")`. It first tries the unauthenticated Syndication API (`cdn.syndication.twimg.com/tweet-result`, `get_tweet_details_syndication` → `createVideoUrlsFromSyndication`), which is the path that currently works. On failure it falls back to the GraphQL pipeline:
  1. `get_tokens`: fetch tweet page → follow meta/JS redirect → optional `x.com/x/migrate` POST (`tok`/`data`) → locate `abs.twimg.com/.../main.*.js` → regex out the bearer token and the `TweetResultByRestId` query ID → POST `guest/activate.json` for a guest token. X's logged-out web client moved to `abs.twimg.com/x-web/` bundles, so the `main.js` lookup currently fails and this fallback is effectively broken.
  2. `get_tweet_details`: call the `TweetResultByRestId` GraphQL endpoint with `features`/`variables` from `RequestDetails.json`. On HTTP 400 it parses the error message for missing variables/features, sets them to `true`, retries, and on success **rewrites `RequestDetails.json`** (the "auto retry" feature from the README). Note axios throws on non-2xx by default, so this branch only runs if that behavior changes.
  3. `createVideoUrls`: from `legacy.extended_entities.media`, pick the highest-bitrate variant per media item (bitrate 0 = GIF).
  4. Stream each URL to disk. One video → `<name>.mp4` (default `output.mp4`); multiple → `<name>-1.mp4`, `<name>-2.mp4`, ….
- `download_video` catches and logs all errors instead of rethrowing, so failures surface in tests only as missing/invalid output files.
- `settings.json` (gif conversion, ffmpeg loglevel) is loaded but currently unused.
- `debugMode` constant at the top of the module toggles `debugLog` output.

## Path assumptions

- `settings.json` is read via a cwd-relative path (`./src/twitter_video_dl/settings.json`), so the module fails unless the process cwd is the repo root.
- The output folder is resolved relative to the repo root (`path.resolve(__dirname, "../..", output_folder_path)`), not the cwd. Tests write to `test/output/` and delete it afterwards.

## Tests

`test/videodlcheck.test.js` generates one jest test per entry in `test/TestInfoFile.jsonc` (parsed with `jsonc-parser`). To add a case, append an object with `url`, `file_name`, `output_directory` (relative to `test/`), and `expected_files`.
