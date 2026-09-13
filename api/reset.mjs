// Vercel function: POST /api/reset. The shared handler is in lib/api.mjs.
import { handleApi } from "../lib/api.mjs";

export const POST = handleApi;
