import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getAccount, getPositions, getOrders, getMarketClock } from "$lib/server/alpaca";

export const GET: RequestHandler = async () => {
  const [account, positions, orders, clock] = await Promise.all([
    getAccount().catch(() => null),
    getPositions().catch(() => []),
    getOrders("all", 10).catch(() => []),
    getMarketClock().catch(() => null),
  ]);

  return json({ account, positions, orders, clock });
};
