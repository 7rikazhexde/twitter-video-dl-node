const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const axios = require("axios");

const script_dir = __dirname;
const request_details_file = path.join(script_dir, "RequestDetails.json");
const request_details = JSON.parse(
  fs.readFileSync(request_details_file, "utf-8")
);

const { features, variables } = request_details;

// Set debug mode true/false
const debugMode = false;

// Define a console.log function that outputs the function name and line number
function debugLog(...args) {
  if (debugMode) {
    const stack = new Error().stack;
    const callerLine = stack.split("\n")[2].trim(); // Get the caller line
    const callerFunctionName = callerLine.match(/at (.+) \(/)[1]; // Get the function name
    console.log(`[${callerFunctionName}] Line ${callerLine}`);
    console.log(...args);
  }
}

// Default timeout (ms) for all HTTP requests, so a stalled connection to
// X's servers can't block the process forever.
const REQUEST_TIMEOUT = 30000;

const http = axios.create({ timeout: REQUEST_TIMEOUT });

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:84.0) Gecko/20100101 Firefox/84.0",
  Accept: "*/*",
  "Accept-Language": "en-US, en;q=0.5",
};

// Hosts a tweet_url is allowed to resolve to before we ever fetch it. Without
// this, a caller could pass any URL and have this process fetch it on their
// behalf (SSRF).
const ALLOWED_TWEET_HOSTS = new Set([
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "x.com",
  "www.x.com",
  "mobile.x.com",
]);

// Reject anything that isn't a twitter.com/x.com link before it's fetched
function validate_tweet_url(tweet_url) {
  let parsed;
  try {
    parsed = new URL(tweet_url);
  } catch (e) {
    parsed = null;
  }
  if (
    !parsed ||
    !["http:", "https:"].includes(parsed.protocol) ||
    !ALLOWED_TWEET_HOSTS.has(parsed.hostname)
  ) {
    throw new Error(
      `Refusing to fetch a non-twitter.com/x.com URL: ${tweet_url}`
    );
  }
}

// Reduce a caller-supplied filename to a single safe path segment, so it
// can't escape output_folder_path (path traversal) or be read as a flag.
function sanitize_filename(name) {
  return path.basename((name || "").trim()).replace(/^-+/, "");
}

// Open setting file
const data = JSON.parse(
  fs.readFileSync("./src/twitter_video_dl/settings.json", "utf-8")
);

// Get the value of convert_gif_flag
//const convert_gif_flag = data.gif.convert_gif_flag;

// Get ffmpeg loglevel
//const ffmpeg_loglevel = data.ffmpeg.loglevel;

async function get_tokens(tweet_url) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:84.0) Gecko/20100101 Firefox/84.0",
    Accept: "*/*",
    "Accept-Language": "en-US, en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    TE: "trailers",
  };

  const session = axios.create({ headers, timeout: REQUEST_TIMEOUT });
  let response = await session.get(tweet_url);

  if (response.status !== 200) {
    throw new Error(
      `Failed to get tweet page. Status code: ${response.status}. Tweet url: ${tweet_url}`
    );
  }

  // Multiple redirect detection methods
  let redirect_url_match = response.data.match(
    /content="0; url = (https:\/\/twitter\.com\/[^"]+)"/
  );

  // Fallback to JavaScript redirect if meta refresh not found
  if (!redirect_url_match) {
    const js_redirect_match = response.data.match(
      /window\.location\.replace\("([^"]+)"\)/
    );
    if (js_redirect_match) {
      redirect_url_match = js_redirect_match;
    }
  }

  // Use original URL if no redirect found
  const redirect_url = redirect_url_match ? redirect_url_match[1] : tweet_url;

  // Attempt to find tok parameter (optional)
  const tok_match = redirect_url.match(/tok=([^&"]+)/);
  const tok = tok_match ? tok_match[1] : null;

  response = await session.get(redirect_url, {
    headers,
    maxRedirects: 0,
    validateStatus: function (status) {
      return status >= 200 && status < 303; // don't throw on redirects
    },
  });

  if (response.status !== 200) {
    throw new Error(
      `Failed to get redirect page. Status code: ${response.status}. Redirect URL: ${redirect_url}`
    );
  }

  // Find data parameter (optional)
  const data_match = response.data.match(
    /<input type="hidden" name="data" value="([^"]+)"/
  );
  const data = data_match ? data_match[1] : null;

  // Prepare authentication request
  const auth_url = "https://x.com/x/migrate";
  const auth_params = {};

  if (tok) {
    auth_params.tok = tok;
  }

  if (data) {
    auth_params.data = data;
  }

  // Only send auth request if we have parameters
  if (Object.keys(auth_params).length > 0) {
    response = await session.post(auth_url, auth_params, { headers });

    if (response.status !== 200) {
      throw new Error(
        `Failed to authenticate. Status code: ${response.status}. Auth URL: ${auth_url}`
      );
    }
  } else {
    response = await session.get(redirect_url, { headers });
  }

  // Find main.js URL
  const mainjs_urls = response.data.match(
    /https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/main\.[^\.]+\.js/g
  );
  
  if (!mainjs_urls || mainjs_urls.length === 0) {
    throw new Error(`Failed to find main.js file. Tweet url: ${tweet_url}`);
  }

  const mainjs_url = mainjs_urls[0];
  const mainjs = await session.get(mainjs_url);

  if (mainjs.status !== 200) {
    throw new Error(
      `Failed to get main.js file. Status code: ${mainjs.status}. Tweet url: ${tweet_url}`
    );
  }

  // Multiple methods to find bearer token
  let bearer_token = mainjs.data.match(/AAAAAAAAA[^"]+/g);

  // Fallback method if first method fails
  if (!bearer_token || bearer_token.length === 0) {
    bearer_token = mainjs.data.match(/Bearer\s+([^\s"]+)/g);
  }

  if (!bearer_token || bearer_token.length === 0) {
    throw new Error(
      `Failed to find bearer token. Tweet url: ${tweet_url}, main.js url: ${mainjs_url}`
    );
  }

  let bearerTokenValue = bearer_token[0];

  // Remove "Bearer " prefix if present
  if (bearerTokenValue.startsWith("Bearer ")) {
    bearerTokenValue = bearerTokenValue.replace("Bearer ", "");
  }

  // Extract Query ID from main.js
  // Example: queryId:"tCVRZ3WCvoj0BVO7BKnL-Q",operationName:"TweetResultByRestId"
  const query_id_match = mainjs.data.match(
    /queryId:"([a-zA-Z0-9_-]+)"[^}]*?operationName:"TweetResultByRestId"/
  );

  if (!query_id_match) {
    throw new Error(
      `Failed to find query ID in main.js. Tweet url: ${tweet_url}, main.js url: ${mainjs_url}`
    );
  }

  const query_id = query_id_match[1];
  debugLog(`query_id: ${query_id}`);

  session.defaults.headers.common[
    "authorization"
  ] = `Bearer ${bearerTokenValue}`;
  const guest_token_response = await session.post(
    "https://api.twitter.com/1.1/guest/activate.json"
  );

  if (guest_token_response.status !== 200) {
    throw new Error(
      `Failed to activate guest token. Status code: ${guest_token_response.status}. Tweet url: ${tweet_url}`
    );
  }

  const guest_token = guest_token_response.data.guest_token;

  if (!guest_token) {
    throw new Error(
      `Failed to find guest token. Tweet url: ${tweet_url}, main.js url: ${mainjs_url}`
    );
  }

  return [bearerTokenValue, guest_token, query_id];
}

function get_details_url(tweet_id, features, variables, query_id) {
  // create a copy of variables - we don't want to modify the original
  const variablesCopy = { ...variables };
  variablesCopy.tweetId = tweet_id;

  return `https://twitter.com/i/api/graphql/${query_id}/TweetResultByRestId?variables=${encodeURIComponent(
    JSON.stringify(variablesCopy)
  )}&features=${encodeURIComponent(JSON.stringify(features))}`;
}

async function get_tweet_details(tweet_url, guest_token, bearer_token, query_id) {
  const tweet_id = tweet_url.match(/(?<=status\/)\d+/);

  if (!tweet_id || tweet_id.length !== 1) {
    throw new Error(
      `Could not parse tweet id from your url. Make sure you are using the correct url. If you are, then file a GitHub issue and copy and paste this message. Tweet url: ${tweet_url}`
    );
  }

  // the url needs a url encoded version of variables and features as a query string
  const url = get_details_url(tweet_id[0], features, variables, query_id);

  const details = await http.get(url, {
    headers: {
      authorization: `Bearer ${bearer_token}`,
      "x-guest-token": guest_token,
    },
  });

  let max_retries = 10;
  let cur_retry = 0;
  while (details.status === 400 && cur_retry < max_retries) {
    let error_json;
    try {
      error_json = JSON.parse(details.data);
    } catch (e) {
      throw new Error(
        `Failed to parse json from details error. details text: ${details.data} If you are using the correct Twitter URL this suggests a bug in the script. Please open a GitHub issue and copy and paste this message. Status code: ${details.status}. Tweet url: ${tweet_url}`
      );
    }

    if (!("errors" in error_json)) {
      throw new Error(
        `Failed to find errors in details error json. If you are using the correct Twitter URL this suggests a bug in the script. Please open a GitHub issue and copy and paste this message. Status code: ${details.status}. Tweet url: ${tweet_url}`
      );
    }

    const needed_variable_pattern = /Variable '([^']+)'/;
    const needed_features_pattern =
      /The following features cannot be null: ([^"]+)/;

    for (const error of error_json.errors) {
      const needed_vars = error.message.match(needed_variable_pattern);
      for (const needed_var of needed_vars) {
        variables[needed_var] = true;
      }

      const needed_features = error.message.match(needed_features_pattern);
      for (const nf of needed_features) {
        for (const feature of nf.split(",")) {
          features[feature.trim()] = true;
        }
      }
    }

    const url = get_details_url(tweet_id[0], features, variables, query_id);

    const details = await http.get(url, {
      headers: {
        authorization: `Bearer ${bearer_token}`,
        "x-guest-token": guest_token,
      },
    });

    cur_retry += 1;

    if (details.status === 200) {
      // save new variables
      request_details.variables = variables;
      request_details.features = features;

      fs.writeFileSync(
        request_details_file,
        JSON.stringify(request_details, null, 4)
      );
    }
  }

  if (details.status !== 200) {
    throw new Error(
      `Failed to get tweet details. If you are using the correct Twitter URL this suggests a bug in the script. Please open a GitHub issue and copy and paste this message. Status code: ${details.status}. Tweet url: ${tweet_url}`
    );
  }

  return details;
}

function createVideoUrls(jsonData) {
  const mediaList =
    jsonData.data.tweetResult.result.legacy.extended_entities.media;
  //console.log(`mediaList: ${JSON.stringify(mediaList, null, 2)}`);
  const videoUrlList = [];

  if (mediaList) {
    for (const mediaItem of mediaList) {
      const videoInfo = mediaItem.video_info;
      if (!videoInfo) continue; // Skip if videoinfo does not exist

      const variants = videoInfo.variants;
      if (!variants) continue; // Skip if variants does not exist

      let videoUrl = null;
      let maxBitrate = 0;

      // variants store URL information for different bitrates and resolutions
      // Extract the video URL with the highest bitrate
      for (const variant of variants) {
        if (variant.bitrate && variant.bitrate > maxBitrate) {
          maxBitrate = variant.bitrate;
          videoUrl = variant.url;
        }
        // gif case
        else if (variant.bitrate == 0) {
          videoUrl = variant.url;
        }
      }

      if (videoUrl) {
        videoUrlList.push(videoUrl);
      }
    }
  }

  return videoUrlList;
}

// Use Twitter's Syndication API to get tweet details.
// This API doesn't require authentication and is more stable than GraphQL.
async function get_tweet_details_syndication(tweet_url) {
  const tweet_id = tweet_url.match(/(?<=status\/)\d+/);

  if (!tweet_id || tweet_id.length !== 1) {
    throw new Error(
      `Could not parse tweet id from your url. Tweet url: ${tweet_url}`
    );
  }

  // Try multiple API endpoints
  const api_urls = [
    `https://cdn.syndication.twimg.com/tweet-result?id=${tweet_id[0]}&lang=en&token=0`,
    `https://cdn.syndication.twimg.com/tweet-result?id=${tweet_id[0]}`,
  ];

  for (const api_url of api_urls) {
    debugLog(`Trying API: ${api_url}`);
    try {
      const response = await http.get(api_url, { headers: BROWSER_HEADERS });
      if (
        response.status === 200 &&
        response.data &&
        typeof response.data === "object" &&
        Object.keys(response.data).length > 0
      ) {
        return response.data;
      }
    } catch (error) {
      debugLog(`Syndication API failed: ${api_url}`, error.message);
    }
  }

  throw new Error(
    `Failed to get tweet details from any Syndication API endpoint. Tweet url: ${tweet_url}`
  );
}

// Pick the highest bitrate mp4 URL from a media item's video_info.variants
function pick_best_mp4_url(media) {
  const variants = (media.video_info && media.video_info.variants) || [];
  let videoUrl = null;
  let maxBitrate = 0;

  for (const variant of variants) {
    if (variant.content_type !== "video/mp4") continue;
    const bitrate = variant.bitrate || 0;
    if (bitrate > maxBitrate) {
      maxBitrate = bitrate;
      videoUrl = variant.url;
    }
    // gif case
    else if (bitrate === 0 && videoUrl === null) {
      videoUrl = variant.url;
    }
  }

  return videoUrl;
}

// Collect video URLs from a list of media items.
// Returns: { videoUrls, gifFlag }
function extract_videos_from_media_list(mediaList) {
  const videoUrls = [];
  let gifFlag = false;

  for (const media of mediaList) {
    if (media.type !== "video" && media.type !== "animated_gif") continue;
    if (media.type === "animated_gif") gifFlag = true;

    const videoUrl = pick_best_mp4_url(media);
    if (videoUrl) {
      videoUrls.push(videoUrl);
    }
  }

  return { videoUrls, gifFlag };
}

// Card-type tweets (promoted/ad tweets) carry their media inside a
// JSON-encoded unified_card instead of the regular media list.
function extract_videos_from_unified_card(unifiedCardStr) {
  if (!unifiedCardStr) return { videoUrls: [], gifFlag: false };

  let unifiedCard;
  try {
    unifiedCard = JSON.parse(unifiedCardStr);
  } catch (e) {
    debugLog(`Failed to parse unified_card JSON: ${e.message}`);
    return { videoUrls: [], gifFlag: false };
  }

  return extract_videos_from_media_list(
    Object.values(unifiedCard.media_entities || {})
  );
}

// Extract video URLs from the Syndication API response.
// Returns: { videoUrls, gifFlag }
function extract_media_from_syndication(syndicationData) {
  let result = extract_videos_from_media_list(
    syndicationData.mediaDetails || []
  );

  // Extract videos from card (for promoted/ad tweets)
  if (result.videoUrls.length === 0) {
    const bindingValues =
      (syndicationData.card && syndicationData.card.binding_values) || {};
    const unifiedCard = bindingValues.unified_card;
    result = extract_videos_from_unified_card(
      unifiedCard && unifiedCard.string_value
    );
  }

  debugLog(`Extracted ${result.videoUrls.length} videos`);
  return result;
}

// X server-renders the tweet page with the GraphQL TweetResultByRestId
// response already embedded as a Relay record, so no bearer/guest token or
// extra API call is needed (unlike get_tokens()/get_tweet_details(), which
// scrape a main.js URL X no longer serves).
const RELAY_RESULT_PATTERN =
  /result:\$R\[\d+\]=\{kind:"Result\.Ok",value:"/;

// Fetch the tweet page and pull out the embedded TweetResultByRestId result
async function get_tweet_result_from_page(tweet_url) {
  validate_tweet_url(tweet_url);

  const response = await http.get(tweet_url, {
    headers: BROWSER_HEADERS,
    responseType: "text",
  });

  if (response.status !== 200) {
    throw new Error(
      `Failed to get tweet page. Status code: ${response.status}. Tweet url: ${tweet_url}`
    );
  }

  const text = response.data;
  const nameIdx = text.indexOf('name:"TweetResultByRestId"');
  if (nameIdx === -1) {
    throw new Error(
      `Could not find an embedded TweetResultByRestId result on the tweet page. Tweet url: ${tweet_url}`
    );
  }

  // The result typically appears shortly after the request name in the
  // page's inlined Relay store script; search a bounded window after it.
  const searchWindow = text.slice(nameIdx, nameIdx + 4000);
  const match = searchWindow.match(RELAY_RESULT_PATTERN);
  if (!match) {
    throw new Error(
      `Could not find a Result.Ok value for TweetResultByRestId. Tweet url: ${tweet_url}`
    );
  }

  // The value is a JS double-quoted string literal (JSON-escaped); walk it
  // by hand to find its unescaped closing quote, then decode it twice -
  // once to unescape the string literal, once to parse the JSON it holds.
  let i = nameIdx + match.index + match[0].length;
  const start = i;
  while (i < text.length && text[i] !== '"') {
    i += text[i] === "\\" ? 2 : 1;
  }

  let tweetResult;
  try {
    tweetResult = JSON.parse(JSON.parse(`"${text.slice(start, i)}"`));
  } catch (e) {
    throw new Error(
      `Failed to parse the embedded TweetResultByRestId JSON. Tweet url: ${tweet_url}. Error: ${e.message}`
    );
  }

  let result =
    (tweetResult.data &&
      tweetResult.data.tweet_result_by_rest_id &&
      tweetResult.data.tweet_result_by_rest_id.result) ||
    {};
  // Some tweets (e.g. age-restricted) wrap the real Tweet one level deeper.
  if (result.__typename !== "Tweet" && result.tweet) {
    result = result.tweet;
  }

  if (result.__typename !== "Tweet") {
    throw new Error(
      `Embedded TweetResultByRestId result wasn't a Tweet (got ${result.__typename}). Tweet url: ${tweet_url}`
    );
  }

  return result;
}

// Extract video URLs from a parsed TweetResultByRestId result.
// Returns: { videoUrls, gifFlag } - same shape as extract_media_from_syndication()
function extract_media_from_tweet_result(result) {
  let media = extract_videos_from_media_list(result.media_entities2 || []);

  // Card-type tweets carry their media inside card.legacy.binding_values
  if (media.videoUrls.length === 0) {
    const bindingValues =
      (result.card && result.card.legacy && result.card.legacy.binding_values) ||
      [];
    const unifiedCard = bindingValues.find((b) => b.key === "unified_card");
    media = extract_videos_from_unified_card(
      unifiedCard && unifiedCard.value && unifiedCard.value.string_value
    );
  }

  debugLog(`Extracted ${media.videoUrls.length} videos from tweet result`);
  return media;
}

async function download_video(
  tweet_url,
  output_file = undefined,
  output_folder_path = "./output"
) {
  try {
    const x_conv_tweet_url = tweet_url.replace(
      "https://twitter.com/",
      "https://x.com/"
    );
    validate_tweet_url(x_conv_tweet_url);
    output_file = sanitize_filename(output_file);

    let videoUrls;
    // Use Syndication API first, then fall back to the embedded tweet page data
    try {
      const syndicationData = await get_tweet_details_syndication(
        x_conv_tweet_url
      );
      ({ videoUrls } = extract_media_from_syndication(syndicationData));
    } catch (error) {
      debugLog(
        `Syndication API failed: ${error.message}. Falling back to embedded tweet page data.`
      );
      const tweetResult = await get_tweet_result_from_page(x_conv_tweet_url);
      ({ videoUrls } = extract_media_from_tweet_result(tweetResult));
    }
    debugLog("videourls:", videoUrls);

    if (videoUrls.length === 0) {
      console.log(`No videos found in tweet: ${tweet_url}`);
      return;
    }

    // Output folder path
    const outputFolderPath = path.resolve(
      __dirname,
      "../..",
      output_folder_path
    );

    // Base name of output file
    let baseFileName = output_file ? output_file.replace(".mp4", "") : "output";
    baseFileName = baseFileName ? baseFileName : "output";

    // Add extension
    if (!output_file.includes(".mp4")) {
      output_file += ".mp4";
    }

    // If the folder does not exist, create it
    if (!fs.existsSync(outputFolderPath)) {
      fs.mkdirSync(outputFolderPath, { recursive: true });
    }

    // Download and save videos from the URL list
    for (let i = 0; i < videoUrls.length; i++) {
      const videoUrl = videoUrls[i];
      let outputPath = "";

      // File name settings
      if (videoUrls.length === 1) {
        outputPath =
          output_file === ".mp4" ||
          output_file === "" ||
          output_file === undefined
            ? "output.mp4"
            : output_file;
      } else {
        outputPath = `${baseFileName}-${i + 1}.mp4`;
      }

      // Get Full Path
      const fullOutputPath = path.resolve(outputFolderPath, outputPath);

      // HTTP request (GET)
      debugLog("videoUrl:", videoUrl);
      const response = await http({
        url: videoUrl,
        method: "GET",
        responseType: "stream",
      });

      // Download and Save
      // pipeline resolves only after the file is fully written and closed
      await pipeline(response.data, fs.createWriteStream(fullOutputPath));
      console.log(`Video ${i + 1} downloaded successfully.`);
    }

    console.log("All videos downloaded successfully.");
  } catch (error) {
    console.error("Error:", error);
  }
}

module.exports = {
  download_video,
  validate_tweet_url,
  sanitize_filename,
  get_tweet_details_syndication,
  extract_media_from_syndication,
  get_tweet_result_from_page,
  extract_media_from_tweet_result,
};
