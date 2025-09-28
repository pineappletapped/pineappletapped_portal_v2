export type PriceTierLevel = 1 | 2 | 3;

export interface PriceTiers {
  tier1?: number | null;
  tier2?: number | null;
  tier3?: number | null;
}

export const PRICE_TIER_LEVELS: PriceTierLevel[] = [1, 2, 3];

export const PRICE_TIER_OPTIONS: { value: PriceTierLevel; label: string }[] = PRICE_TIER_LEVELS.map(
  (level) => ({
    value: level,
    label: `Tier ${level}`,
  })
);

export const DEFAULT_PRICE_TIER: PriceTierLevel = 1;

export function normalisePriceTierLevel(value: unknown): PriceTierLevel {
  const num = Number(value);
  if (num === 2 || num === 3) {
    return num;
  }
  return DEFAULT_PRICE_TIER;
}

export function getPriceForTier(
  basePrice: number,
  tiers: PriceTiers | null | undefined,
  tier: PriceTierLevel | null | undefined
): number {
  if (!tiers) {
    return basePrice;
  }
  const level = tier ?? DEFAULT_PRICE_TIER;
  if (level === 3 && typeof tiers.tier3 === "number") {
    return tiers.tier3;
  }
  if (level === 2 && typeof tiers.tier2 === "number") {
    return tiers.tier2;
  }
  if (typeof tiers.tier1 === "number") {
    return tiers.tier1;
  }
  return basePrice;
}

export function hasNonDefaultTierPricing(tiers: PriceTiers | null | undefined): boolean {
  if (!tiers) return false;
  const { tier2, tier3 } = tiers;
  return (typeof tier2 === "number" && Number.isFinite(tier2)) || (typeof tier3 === "number" && Number.isFinite(tier3));
}
