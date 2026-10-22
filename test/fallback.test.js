/**
 * Tests for the fallback used when the Syndication API fails.
 *
 * X's server-rendered tweet page embeds the TweetResultByRestId GraphQL
 * result directly (as a Relay record), so the fallback parses that out of
 * the page instead of scraping a bearer token out of a main.js bundle.
 */
const fs = require("fs");
const { parse } = require("jsonc-parser");
const tvdl = require("../src/twitter_video_dl/twitter_video_dl");

const testData = parse(fs.readFileSync("./test/TestInfoFile.jsonc", "utf8"));

describe("Embedded tweet page fallback tests", () => {
  test("get_tweet_result_from_page returns a Tweet with media", async () => {
    const result = await tvdl.get_tweet_result_from_page(
      "https://x.com/tw_7rikazhexde/status/1650804112987136000"
    );

    expect(result.__typename).toBe("Tweet");
    expect(result).toHaveProperty("media_entities2");
  }, 30000);

  test("extract_media_from_tweet_result extracts video URLs", async () => {
    const result = await tvdl.get_tweet_result_from_page(
      "https://x.com/tw_7rikazhexde/status/1650804112987136000"
    );
    const { videoUrls, gifFlag } = tvdl.extract_media_from_tweet_result(result);

    expect(videoUrls.length).toBeGreaterThan(0);
    expect(videoUrls.every((url) => url.startsWith("http"))).toBe(true);
    expect(typeof gifFlag).toBe("boolean");
  }, 30000);

  test("an animated GIF tweet is reported as a GIF", async () => {
    const result = await tvdl.get_tweet_result_from_page(
      "https://x.com/tw_7rikazhexde/status/1735502484700057703"
    );
    const { videoUrls, gifFlag } = tvdl.extract_media_from_tweet_result(result);

    expect(videoUrls.length).toBeGreaterThan(0);
    expect(gifFlag).toBe(true);
  }, 30000);

  test("an invalid tweet URL is rejected", async () => {
    await expect(
      tvdl.get_tweet_result_from_page(
        "https://x.com/tw_7rikazhexde/status/invalid"
      )
    ).rejects.toThrow();
  }, 30000);

  test("a non-twitter.com/x.com URL is refused before it is fetched", async () => {
    await expect(
      tvdl.get_tweet_result_from_page("http://169.254.169.254/status/1")
    ).rejects.toThrow(/Refusing to fetch/);
  });

  // Same cases as videodlcheck.test.js, resolved via the fallback instead
  testData.tests.forEach((testDataItem, index) => {
    test(`Test ${index + 1}: fallback finds ${testDataItem.expected_files.length} video(s)`, async () => {
      const result = await tvdl.get_tweet_result_from_page(testDataItem.url);
      const { videoUrls } = tvdl.extract_media_from_tweet_result(result);

      expect(videoUrls.length).toBe(testDataItem.expected_files.length);
    }, 30000);
  });
});
