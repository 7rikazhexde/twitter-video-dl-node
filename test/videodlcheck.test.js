const tvdl = require("../src/twitter_video_dl/twitter_video_dl");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const { parse } = require("jsonc-parser");
const OUTPUT_FOLDER_PATH = "./test/output";

/**
 * Function to parse a video file from a list of video file paths with the ffprobe command
 */
async function checkMultipleVideos(videoFilePaths, audioCheckFlag = false) {
  for (const videoFilePath of videoFilePaths) {
    const probe = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoFilePath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata);
      });
    });

    // Verify video is loaded correctly and stream exists
    if (!probe || !probe.streams || probe.streams.length === 0) {
      throw new Error(`No streams found in the video: ${videoFilePath}`);
    }

    // Get first video stream
    const videoStream = probe.streams.find(
      (stream) => stream.codec_type === "video"
    );
    if (!videoStream) {
      throw new Error(`No video stream found in the video: ${videoFilePath}`);
    }

    if (audioCheckFlag) {
      // Get the first audio stream
      const audioStream = probe.streams.find(
        (stream) => stream.codec_type === "audio"
      );
      if (!audioStream) {
        throw new Error(`No audio stream found in the video: ${videoFilePath}`);
      }
    }
  }
}

// テストデータのJSONCファイルを読み込む
const content = fs.readFileSync("./test/TestInfoFile.jsonc", "utf8");

// JSONCをパースしてオブジェクトに変換
const testData = parse(content);

/**
 * Test function
 */
describe("Video downloaded tests", () => {
  testData.tests.forEach((testDataItem, index) => {
    test(
      `Test ${index + 1}: should download and save the video files with sequential names`,
      async () => {
        try {
          // テストデータ準備
          const { url, file_name, output_directory, expected_files } =
            testDataItem;
          const output_file_paths = expected_files.map((file) =>
            path.join(__dirname, output_directory, file)
          );

          // 動画保存
          await tvdl.download_video(url, file_name, OUTPUT_FOLDER_PATH);

          // テスト実行
          // 動画ファイル解析
          await checkMultipleVideos(output_file_paths);

          // 期待されるファイルが存在するか確認
          const fileExists = output_file_paths.every((filePath) =>
            fs.existsSync(filePath)
          );

          // テスト実行
          expect(fileExists).toBe(true);
        } catch (error) {
          // エラーが発生した場合は、エラーをスローして失敗としてマークする
          throw error;
        } finally {
          // テストの最後に、outputフォルダを削除
          if (fs.existsSync(OUTPUT_FOLDER_PATH)) {
            fs.rmSync(OUTPUT_FOLDER_PATH, { recursive: true, force: true });
          }
        }
      },
      10000
    ); // タイムアウト設定
  });

  // 全てのテストが終了した後にoutputフォルダを削除
  afterAll(() => {
    if (fs.existsSync(OUTPUT_FOLDER_PATH)) {
      fs.rmSync(OUTPUT_FOLDER_PATH, { recursive: true, force: true });
    }
  });
});