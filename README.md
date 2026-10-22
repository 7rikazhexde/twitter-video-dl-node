# twitter-video-dl-node

This project is based on the original code of the [7rikazhexde / twitter-video-dl-for-sc](https://github.com/7rikazhexde/twitter-video-dl-for-sc) project, which allows users to download X(Twitter) App videos as MP4 files using Node.js, URLs without the need for API keys.

## ToC

- [twitter-video-dl-node](#twitter-video-dl-node)
  - [ToC](#toc)
  - [Requirements](#requirements)
  - [Usage](#usage)
  - [Auto Retry Feature](#auto-retry-feature)
  - [Test-Environment](#test-environment)

## Requirements

Node.js and pnpm versions are pinned in `mise.toml` and managed with [mise](https://mise.jdx.dev/).

> [!IMPORTANT]
> Node.js **22.23.4 / 24.22.1 / 26.12.1 or later** is required.
> Earlier versions still trust the compromised eMudhra emSign CA intermediates ([advisory](https://emudhra.we-have-a-problem.com/)).

```bash
mise install
pnpm install
```

`pnpm-workspace.yaml` enables supply-chain protections: versions published less than 7 days ago are not installed, trust downgrades (e.g. lost provenance) fail the install, and dependency install scripts are blocked.

## Usage

1. Run `mise install` and `pnpm install` (see [Requirements](#requirements))
2. See a video on X(Twitter) App that you want to save.
3. Invoke the script, e.g.:

```bash
# File name specified
node twitter-video-dl-node https://twitter.com/i/status/1650804112987136000 output_file_name
```

```bash
# Without file name
node twitter-video-dl-node https://twitter.com/i/status/1650804112987136000 ""
```

Done, now you should have an mp4 file of the highest bitrate version of that video available.

## Auto Retry Feature

> [!NOTE]
> **[Same as twitter-video-dl-for-sc and depends on it.](https://github.com/7rikazhexde/twitter-video-dl-for-sc)**  

From time to time, every week or so, Twitter will add some new request parameters that they expect from callers asking for their content.  Twitter refers to these as "features" or "variables".  The twitter-video-dl script will try to detect when a new feature or variable has been added and automatically accommodate the new element.  This is not foolproof though.  It's possible the script will fail with an error message.  If it does, please open an issue (or send a PR).

## Test-Environment

If you get an error with the specified URL, please register an issue. If you want to test individually, you can test in advance by adding the URL of the post where the video was posted to `tests/TestInfoFile.jsonc`.

> [!NOTE]
> **- The test environment depends on **jest**, which is added as part of the dev environment dependency(devDependencies) files with the `pnpm install` command.**  
> **- You can run the test command in `pnpm test`.**  
> **- Tests verify the downloaded files with `ffprobe`, so ffmpeg must be installed.**
