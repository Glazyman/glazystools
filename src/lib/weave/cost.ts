// Weave — what a board has cost you.
//
// Pricing is fetched from the AI Gateway rather than hard-coded: a price table
// in the source is wrong the moment Google changes a number, and wrong quietly.
// The gateway already knows, so ask it.

import { gateway } from "@ai-sdk/gateway";

type Price = { input: number; output: number };

let cache: Map<string, Price> | null = null;
let cachedAt = 0;
const TTL_MS = 60 * 60 * 1000; // prices don't move often; one fetch an hour

async function prices(): Promise<Map<string, Price>> {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const { models } = await gateway.getAvailableModels();
  const next = new Map<string, Price>();
  for (const m of models) {
    if (!m.pricing) continue;
    const input = Number(m.pricing.input);
    const output = Number(m.pricing.output);
    if (Number.isFinite(input) && Number.isFinite(output)) {
      next.set(m.id, { input, output });
    }
  }
  cache = next;
  cachedAt = Date.now();
  return next;
}

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
};

/**
 * USD for one call, or null if we can't say. Null rather than 0 on purpose —
 * a total that silently under-reports is worse than one that admits a gap.
 */
export async function costOf(
  model: string,
  usage: Usage | undefined,
): Promise<number | null> {
  if (!usage) return null;
  try {
    const p = (await prices()).get(model);
    if (!p) return null;
    // Reasoning tokens are billed as output and are already counted in
    // outputTokens by the SDK, so there's nothing extra to add here.
    return (usage.inputTokens ?? 0) * p.input + (usage.outputTokens ?? 0) * p.output;
  } catch {
    // Never fail a real request because the price list didn't load.
    return null;
  }
}
