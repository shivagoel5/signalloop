// Vercel function: GET /api/session. The shared handler is in lib/api.mjs.
import { handleApi } from "../lib/api.mjs";

export const GET = handleApi;
