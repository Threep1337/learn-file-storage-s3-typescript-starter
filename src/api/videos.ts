import { respondWithJSON } from "./json";
import { type ApiConfig } from "../config";
import { S3Client, type BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getVideo, updateVideo } from "../db/videos";
import { getBearerToken, validateJWT } from "../auth";
import { randomBytes } from "node:crypto";
import path from 'node:path';
import { rm } from "fs/promises";
import { getAsset } from "node:sea";
/// <reference types="bun" />
import {type Video } from "../db/videos";

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const MAX_UPLOAD_SIZE = 1 << 30;

  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const videoMetadata = getVideo(cfg.db, videoId);
  if (videoMetadata?.userID != userID) {
    throw new UserForbiddenError("User is unauthorized");
  }

  const data = await req.formData();
  const videoData = data.get("video");

  if (!(videoData instanceof File)) {
    throw new BadRequestError("The uploaded video is not a file!");
  }


  if (videoData.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError(`The video is too large! The size is ${videoData.size} and the max size is ${MAX_UPLOAD_SIZE}`)
  }

  const mediaType = videoData.type

  const validMediaTypes = ["video/mp4"];

  if (!(validMediaTypes.includes(mediaType))) {
    throw new BadRequestError("Invalid media type, it must be a video file!");
  }

  const bufferArray = await videoData.arrayBuffer();

  const fileExtension = mediaType.split("/")[1];
  const randomName = randomBytes(32).toString("base64url");
  const filePath = path.join(cfg.assetsRoot, (randomName + "." + fileExtension));
  console.log(`Constructed temporary file path is ${filePath}`);
  await Bun.write(filePath, bufferArray);

  const processedVideoPath = await processVideoForFastStart(filePath);

  const aspectRatio = await getVideoAspectRatio(processedVideoPath);

  const file = S3Client.file((aspectRatio + "/" + randomName + "." + fileExtension));
  file.write(Bun.file(processedVideoPath, {
    type: mediaType
  }));

  videoMetadata.videoURL = `${cfg.s3CfDistribution + aspectRatio + "/" + randomName + "." + fileExtension}`;
  updateVideo(cfg.db, videoMetadata);
  await Promise.all([rm(filePath, { force: true }),rm(processedVideoPath, { force: true })]);

  return respondWithJSON(200, videoMetadata);
}




export async function getVideoAspectRatio(filePath:string): Promise<string> {
  //ffprobe -v error -print_format json -show_streams PATH_TO_VIDEO

  const proc = Bun.spawn([
    "ffprobe",
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "json",
    filePath
  ]);

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  console.log(`stdoutText: ${stdoutText}`);
  console.log(`stderrText: ${stderrText}`)

  if (proc.exitCode && proc.exitCode != 0)
  {
    console.log(`The exit code is ${proc.exitCode}`)
    throw new BadRequestError("Error running ffprobe!")
  }

  const jsonOutput = JSON.parse(stdoutText);
  const width = jsonOutput.streams[0].width;
  const height = jsonOutput.streams[0].height;

  const ratio = width/height;

  if ((ratio < (9/16)+ 0.1 ) && (ratio > (9/16)-0.1 )){
    return "portrait";
  }
  else if ((ratio < (16/9)+ 0.1 ) && (ratio > (16/9)-0.1 ))
  {
    return "landscape";
  }

  return "other";

}

export async function processVideoForFastStart(inputFilePath: string){

  const processedFilePath = inputFilePath + ".processed";

    const proc = Bun.spawn([
    "ffmpeg",
    "-i", inputFilePath,
    "-movflags", "faststart",
    "-map_metadata", "0",
    "-codec", "copy",
    "-f","mp4",
    processedFilePath
  ]);

  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  console.log(`stdoutText: ${stdoutText}`);
  console.log(`stderrText: ${stderrText}`);

  if (proc.exitCode && proc.exitCode != 0)
  {
    console.log(`The exit code is ${proc.exitCode}`);
    throw new BadRequestError("Error running ffmpeg!");
  }

  return processedFilePath;
}