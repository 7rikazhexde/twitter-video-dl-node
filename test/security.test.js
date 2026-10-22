const tvdl = require("../src/twitter_video_dl/twitter_video_dl");

describe("Input sanitization tests", () => {
  test("sanitize_filename strips directories and leading dashes", () => {
    expect(tvdl.sanitize_filename("../../etc/out.mp4")).toBe("out.mp4");
    expect(tvdl.sanitize_filename("--flag.mp4")).toBe("flag.mp4");
    expect(tvdl.sanitize_filename(undefined)).toBe("");
  });

  test("validate_tweet_url only allows twitter.com/x.com", () => {
    expect(() =>
      tvdl.validate_tweet_url("https://x.com/a/status/1")
    ).not.toThrow();
    expect(() =>
      tvdl.validate_tweet_url("https://twitter.com/a/status/1")
    ).not.toThrow();
    expect(() =>
      tvdl.validate_tweet_url("https://x.com.evil.example/a/status/1")
    ).toThrow();
    expect(() => tvdl.validate_tweet_url("file:///etc/passwd")).toThrow();
  });
});
