import type { PageServerLoad } from "./$types";
import {
  getAccount,
  getPositions,
  getOrders,
  getPortfolioHistory,
  getMarketClock,
} from "$lib/server/alpaca";
import { getAgentState, getDecisions } from "$lib/server/state";

export const load: PageServerLoad = async () => {
  try {
    const [account, positions, orders, history, clock, agentState, decisions] =
      await Promise.all([
        getAccount().catch(() => null),
        getPositions().catch(() => []),
        getOrders("all", 10).catch(() => []),
        getPortfolioHistory("1M").catch(() => null),
        getMarketClock().catch(() => null),
        Promise.resolve(getAgentState()),
        Promise.resolve(getDecisions(30)),
      ]);

    return {
      account,
      positions,
      orders,
      history,
      clock,
      agentState,
      decisions,
    };
  } catch {
    return {
      account: null,
      positions: [],
      orders: [],
      history: null,
      clock: null,
      agentState: null,
      decisions: [],
    };
  }
};
