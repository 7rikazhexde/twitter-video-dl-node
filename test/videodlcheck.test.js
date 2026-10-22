const tvdl = require("../src/twitter_video_dl/twitter_video_dl");
const fs = require("fs");
const path = require("path");
const { createFile } = require("mp4box");
const { parse } = require("jsonc-parser");
const OUTPUT_FOLDER_PATH = "./test/output";

/**
 * Walk the top-level MP4 boxes and return their types.
 * Throws if a box runs past the end of the file (e.g. a truncated download).
 */
function readTopLevelBoxTypes(buf, videoFilePath) {
  const types = [];
  let offset = 0;
  while (offset < buf.length) {
    if (offset + 8 > buf.length) {
      throw new Error(`Truncated box header in the video: ${videoFilePath}`);
    }
    let size = buf.readUInt32BE(offset);
    const type = buf.toString("latin1", offset + 4, offset + 8);
    if (size === 1) {
      // 64-bit largesize follows the type
      size = Number(buf.readBigUInt64BE(offset + 8));
    } else if (size === 0) {
      // Box extends to the end of the file
      size = buf.length - offset;
    }
    if (size < 8 || offset + size > buf.length) {
      throw new Error(
        `Box "${type}" exceeds the file size in the video: ${videoFilePath}`
      );
    }
    types.push(type);
    offset += size;
  }
  return types;
}

/**
 * Parse each MP4 with mp4box.js and verify it is complete and has a video
 * (and optionally an audio) track. ffprobe is not used because the downloader
 * itself never needs ffmpeg, so tests shouldn't either.
 */
async function checkMultipleVideos(videoFilePaths, audioCheckFlag = false) {
  for (const videoFilePath of videoFilePaths) {
    const buf = fs.readFileSync(videoFilePath);

    const boxTypes = readTopLevelBoxTypes(buf, videoFilePath);
    for (const required of ["ftyp", "moov", "mdat"]) {
      if (!boxTypes.includes(required)) {
        throw new Error(
          `Missing "${required}" box in the video: ${videoFilePath}`
        );
      }
    }

    const arrayBuffer = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength
    );
    arrayBuffer.fileStart = 0;

    let info = null;
    let parseError = null;
    const mp4File = createFile();
    mp4File.onReady = (readyInfo) => {
      info = readyInfo;
    };
    mp4File.onError = (error) => {
      parseError = error;
    };
    mp4File.appendBuffer(arrayBuffer);
    mp4File.flush();

    if (parseError || !info) {
      throw new Error(
        `Failed to parse the video: ${videoFilePath} ${parseError || ""}`
      );
    }

    if (info.videoTracks.length === 0) {
      throw new Error(`No video stream found in the video: ${videoFilePath}`);
    }

    if (audioCheckFlag && info.audioTracks.length === 0) {
      throw new Error(`No audio stream found in the video: ${videoFilePath}`);
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