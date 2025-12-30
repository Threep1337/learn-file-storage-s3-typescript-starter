//TS file solely used to test functions as I code them
import { getVideoAspectRatio } from "./api/videos";


const ratio = await getVideoAspectRatio("/home/threep/bootdev/bootFileStorage/samples/boots-video-vertical.mp4");


console.log (`ratio: ${ratio}`);

