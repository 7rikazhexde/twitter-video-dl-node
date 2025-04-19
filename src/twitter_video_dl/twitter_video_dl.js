const fs = require("fs");
const path = require("path");
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

  const session = axios.create({ headers });
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
    /https:\/\/abs\.twimg\.com\/responsive-web\/client-web-legacy\/main\.[^\.]+\.js/g
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

  return [bearerTokenValue, guest_token];
}

function get_details_url(tweet_id, features, variables) {
  // create a copy of variables - we don't want to modify the original
  const variablesCopy = { ...variables };
  variablesCopy.tweetId = tweet_id;

  return `https://twitter.com/i/api/graphql/0hWvDhmW8YQ-S_ib3azIrw/TweetResultByRestId?variables=${encodeURIComponent(
    JSON.stringify(variablesCopy)
  )}&features=${encodeURIComponent(JSON.stringify(features))}`;
}

async function get_tweet_details(tweet_url, guest_token, bearer_token) {
  const tweet_id = tweet_url.match(/(?<=status\/)\d+/);

  if (!tweet_id || tweet_id.length !== 1) {
    throw new Error(
      `Could not parse tweet id from your url. Make sure you are using the correct url. If you are, then file a GitHub issue and copy and paste this message. Tweet url: ${tweet_url}`
    );
  }

  // the url needs a url encoded version of variables and features as a query string
  const url = get_details_url(tweet_id[0], features, variables);

  const details = await axios.get(url, {
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

    const url = get_details_url(tweet_id[0], features, variables);

    const details = await axios.get(url, {
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
    debugLog(`bearer_token: ${tweet_url}`);
    debugLog(`guest_token: ${x_conv_tweet_url}`);
    const [bearer_token, guest_token] = await get_tokens(x_conv_tweet_url);
    debugLog(`bearer_token: ${bearer_token}`);
    debugLog(`guest_token: ${guest_token}`);

    const resp = await get_tweet_details(tweet_url, guest_token, bearer_token);
    debugLog(`resp.data: ${JSON.stringify(resp.data, null, 2)}`);

    const videoUrls = createVideoUrls(resp.data);
    debugLog("videourls:", videoUrls);

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
      const response = await axios({
        url: videoUrl,
        method: "GET",
        responseType: "stream",
      });

      // Download and Save
      response.data.pipe(fs.createWriteStream(fullOutputPath));

      await new Promise((resolve, reject) => {
        response.data.on("end", () => {
          console.log(`Video ${i + 1} downloaded successfully.`);
          resolve();
        });

        response.data.on("error", (error) => {
          console.error("Error:", error);
          reject(error);
        });
      });
    }

    console.log("All videos downloaded successfully.");
  } catch (error) {
    console.error("Error:", error);
  }
}

module.exports = { download_video };
