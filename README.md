# twitter-video-dl-node

This project is based on the original code of the [7rikazhexde / twitter-video-dl-for-sc](https://github.com/7rikazhexde/twitter-video-dl-for-sc) project, which allows users to download X(Twitter) App videos as MP4 files using Node.js, URLs without the need for API keys.

## ToC

- [twitter-video-dl-node](#twitter-video-dl-node)
  - [ToC](#toc)
  - [Usage](#usage)
  - [Auto Retry Feature](#auto-retry-feature)
  - [Test-Environment](#test-environment)

## Usage

1. Run the `npm install` command
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
> **- The test environment depends on **jest**, which is added as part of the dev environment dependency(devDependencies) files with the `npm install` command.**  
> **- You can run the test command in `npm test`.**
