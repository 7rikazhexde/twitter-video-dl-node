# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Node.js CLI that downloads X (Twitter) videos as MP4 without API keys, via the unauthenticated Syndication API with a fallback to the GraphQL result X embeds in the tweet page. It is a port of the Python project [twitter-video-dl-for-sc](https://github.com/7rikazhexde/twitter-video-dl-for-sc); fixes for X-side changes (token scraping, GraphQL features/variables) usually originate there and should stay in sync with it.

## Commands

Run everything from the repository root (see "Path assumptions" below). Node.js and pnpm are pinned in `mise.toml` (not Volta/npm). Node must stay at a release that distrusts the compromised eMudhra emSign CA intermediates (22.23.4 / 24.22.1 / 26.12.1 or later; enforced via `engines` + `engineStrict`).

```bash
mise install && pnpm install
node twitter-video-dl-node <tweet_url> <file_name>   # file_name may be "" → output.mp4
pnpm test                                            # jest; all tests
pnpm exec jest -t "Test 3"                           # single test case by name
```

`pnpm-workspace.yaml` holds supply-chain settings: `minimumReleaseAge` (7 days), `trustPolicy: no-downgrade` (with `trustPolicyExclude` for verified exceptions), and `allowBuilds` (dependency install scripts are denied). If an install fails on one of these, investigate the package before adding an exception.

Workflows mirror twitter-video-dl-for-sc's (keep them in sync). `ci.yml` has two jobs: `test-syndication` (`videodlcheck` + `security` tests, required) and `test-graphql-fallback` (`fallback` tests, advisory, not required). `pnpm-audit.yml` runs `pnpm audit --prod` on PR/push and weekly; `dependency-review.yml` checks dependency diffs on PRs. No `paths` filters, since required checks must report on every PR. Actions are pinned by commit SHA; Dependabot (`.github/dependabot.yml`, one grouped PR per ecosystem, 7-day cooldown to match `minimumReleaseAge`) updates npm deps and action SHAs. `main` is protected by a ruleset: changes (including version bumps) must go through a PR with `test-syndication`, `dependency-review`, and `pnpm-audit` passing; force pushes and deletion are blocked.

Tests are live integration tests: they hit x.com over the network and verify output with `ffprobe` (via `fluent-ffmpeg`), so `ffmpeg`/`ffprobe` must be installed on PATH. Each test has a 10s timeout.

## Architecture

- `twitter-video-dl-node.js` — yargs CLI entry; calls `download_video(url, file_name)`.
- `src/twitter_video_dl/twitter_video_dl.js` — all logic. `download_video(tweet_url, output_file, output_folder_path = "./output")` is the entry point; the other exports exist for tests. Flow:
  1. `validate_tweet_url` (host allowlist: twitter.com/x.com, SSRF guard) and `sanitize_filename` (basename, strip leading `-`, path-injection guard).
  2. Primary: Syndication API (`cdn.syndication.twimg.com/tweet-result`, `get_tweet_details_syndication` → `extract_media_from_syndication`).
  3. Fallback: `get_tweet_result_from_page` fetches the x.com tweet page and decodes the `TweetResultByRestId` Relay record X embeds in it (a JS string literal holding JSON, decoded twice) → `extract_media_from_tweet_result` (`media_entities2`).
  4. Both extractors pick the highest-bitrate mp4 per video/GIF and fall back to the card `unified_card` media for promoted tweets; they return `{ videoUrls, gifFlag }`. Images are intentionally not downloaded (unlike the Python project).
  5. Stream each URL to disk. One video → `<name>.mp4` (default `output.mp4`); multiple → `<name>-1.mp4`, `<name>-2.mp4`, ….
- All HTTP goes through `http` (axios with a 30s timeout).
- `get_tokens` / `get_tweet_details` / `createVideoUrls` (bearer token from `main.js` + GraphQL API, with `RequestDetails.json`) are the old fallback, kept like in the Python project but no longer called: X no longer serves the `main.js` they scrape.
- `download_video` catches and logs all errors instead of rethrowing, so failures surface in tests only as missing/invalid output files.
- `settings.json` (gif conversion, ffmpeg loglevel) is loaded but currently unused.
- `debugMode` constant at the top of the module toggles `debugLog` output.

## Path assumptions

- `settings.json` is read via a cwd-relative path (`./src/twitter_video_dl/settings.json`), so the module fails unless the process cwd is the repo root.
- The output folder is resolved relative to the repo root (`path.resolve(__dirname, "../..", output_folder_path)`), not the cwd. Tests write to `test/output/` and delete it afterwards.

## Tests

`test/videodlcheck.test.js` generates one jest test per entry in `test/TestInfoFile.jsonc` (parsed with `jsonc-parser`) and downloads via `download_video`. `test/fallback.test.js` resolves the same cases through the embedded-page fallback and checks the video count; `test/security.test.js` covers URL/filename validation (offline). To add a case, append an object with `url`, `file_name`, `output_directory` (relative to `test/`), and `expected_files`.
