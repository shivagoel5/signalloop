// Vercel function: POST /api/run. The shared handler is in lib/api.mjs.
import { handleApi } from "../lib/api.mjs";

export const POST = handleApi;
