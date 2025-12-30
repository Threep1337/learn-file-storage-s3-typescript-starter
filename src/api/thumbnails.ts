import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from 'node:path';
import { randomBytes } from "node:crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

//const videoThumbnails: Map<string, Thumbnail> = new Map();

// export async function handlerGetThumbnail(cfg: ApiConfig, req: BunRequest) {
//   const { videoId } = req.params as { videoId?: string };
//   if (!videoId) {
//     throw new BadRequestError("Invalid video ID");
//   }

//   const video = getVideo(cfg.db, videoId);
//   if (!video) {
//     throw new NotFoundError("Couldn't find video");
//   }

//   const thumbnail = videoThumbnails.get(videoId);
//   if (!thumbnail) {
//     throw new NotFoundError("Thumbnail not found");
//   }

//   return new Response(thumbnail.data, {
//     headers: {
//       "Content-Type": thumbnail.mediaType,
//       "Cache-Control": "no-store",
//     },
//   });
// }

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const data = await req.formData();

  const thumbnail = data.get("thumbnail");

  if (!(thumbnail instanceof File))
  {
    throw new BadRequestError("The uploaded thumbnail is not a file!");
  }
  const MAX_UPLOAD_SIZE = 10 << 20;

  const mediaType = thumbnail.type
  const bufferArray = await thumbnail.arrayBuffer();

  //const bufferString = Buffer.from(bufferArray).toString("base64");
  //const dataUrl = `data:${mediaType};base64,${bufferString}`;

  const videoMetadata = getVideo(cfg.db,videoId);
  if (videoMetadata?.userID != userID)
  {
    throw new UserForbiddenError("User is unauthorized");
  }

  //videoThumbnails.set(videoId,{data: bufferArray, mediaType:mediaType});
  //const thumbnailURL = `http://localhost:${cfg.port}/api/thumbnails/${videoId}`

  const validMediaTypes = ["image/png","image/jpg"];

  if (!(validMediaTypes.includes(mediaType)))
  {
    throw new BadRequestError("Invalid media type");
  }

  const fileExtension = mediaType.split("/")[1];
  const randomName = randomBytes(32).toString("base64url");
  const filePath = path.join(cfg.assetsRoot,(randomName + "." + fileExtension));

  console.log(`Constructed file path is ${filePath}`);
  await Bun.write(filePath,bufferArray);

  videoMetadata.thumbnailURL = `http://localhost:${cfg.port}/assets/${randomName + "." + fileExtension}`;
  updateVideo(cfg.db,videoMetadata);

  return respondWithJSON(200, videoMetadata);
}
