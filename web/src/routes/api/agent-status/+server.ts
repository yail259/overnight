import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAgentState } from "$lib/server/state";

export const GET: RequestHandler = async () => {
  const state = getAgentState();
  return json({ state });
};
