import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getDecisions } from "$lib/server/state";

export const GET: RequestHandler = async ({ url }) => {
  const limit = Number(url.searchParams.get("limit") ?? 30);
  const decisions = getDecisions(limit);
  return json({ decisions });
};
