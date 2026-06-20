export type DealScoreResult = {
  score: number;
  label: string;
  emoji: string;
  color: string;
  breakdown?: {
    profitMargin: number;
    rarityBonus: number;
    liquidityScore: number;
    ageScore: number;
    confidencePenalty?: number;
  };
};

export type SimpleDealScore = {
  score: number;
  label: string;
  emoji: string;
  color: string;
};

export function calculateDealScore(
  purchasePrice: number,
  marketValue: number,
  salesVolume: number = 0,
  priceVolatility: number = 0,
  inventoryAgeDays: number = 0
): DealScoreResult {
  if (marketValue === 0 || purchasePrice === 0) {
    return {
      score: 0,
      label: 'No Data',
      emoji: '❓',
      color: 'text-gray-400',
    };
  }

  const profitMargin = ((marketValue - purchasePrice) / purchasePrice) * 100;
  const profitAmount = marketValue - purchasePrice;

  let baseScore = 0;
  if (profitMargin >= 300) baseScore = 95;
  else if (profitMargin >= 200) baseScore = 90;
  else if (profitMargin >= 150) baseScore = 85;
  else if (profitMargin >= 100) baseScore = 75;
  else if (profitMargin >= 75) baseScore = 65;
  else if (profitMargin >= 50) baseScore = 55;
  else if (profitMargin >= 30) baseScore = 45;
  else if (profitMargin >= 15) baseScore = 35;
  else if (profitMargin >= 5) baseScore = 25;
  else if (profitMargin >= 0) baseScore = 15;
  else baseScore = 5;

  const absoluteProfitBonus = Math.min(profitAmount / 10, 10);

  let rarityBonus = 0;
  if (salesVolume === 0) {
    rarityBonus = 15;
  } else if (salesVolume <= 2) {
    rarityBonus = 12;
  } else if (salesVolume <= 5) {
    rarityBonus = 8;
  } else if (salesVolume <= 10) {
    rarityBonus = 5;
  } else if (salesVolume <= 20) {
    rarityBonus = 2;
  } else {
    rarityBonus = -5;
  }

  let liquidityScore = 0;
  if (salesVolume >= 50) {
    liquidityScore = 10;
  } else if (salesVolume >= 30) {
    liquidityScore = 7;
  } else if (salesVolume >= 15) {
    liquidityScore = 5;
  } else if (salesVolume >= 8) {
    liquidityScore = 3;
  } else if (salesVolume >= 3) {
    liquidityScore = 0;
  } else {
    liquidityScore = -8;
  }

  let agePenalty = 0;
  if (inventoryAgeDays > 180) {
    agePenalty = 25;
  } else if (inventoryAgeDays > 120) {
    agePenalty = 18;
  } else if (inventoryAgeDays > 90) {
    agePenalty = 12;
  } else if (inventoryAgeDays > 60) {
    agePenalty = 8;
  } else if (inventoryAgeDays > 30) {
    agePenalty = 4;
  }

  const volatilityPenalty = Math.min(priceVolatility * 3, 10);

  let finalScore = baseScore + absoluteProfitBonus + rarityBonus + liquidityScore - agePenalty - volatilityPenalty;

  if (profitMargin >= 100 && profitAmount >= 20) {
    finalScore += 5;
  }

  finalScore = Math.max(0, Math.min(100, finalScore));

  const breakdown = {
    profitMargin: baseScore,
    rarityBonus: rarityBonus,
    liquidityScore: liquidityScore,
    ageScore: -agePenalty,
  };

  if (finalScore >= 85) {
    return {
      score: Math.round(finalScore),
      label: 'Steal',
      emoji: '🔥',
      color: 'text-green-400',
      breakdown,
    };
  } else if (finalScore >= 70) {
    return {
      score: Math.round(finalScore),
      label: 'Great',
      emoji: '💎',
      color: 'text-emerald-400',
      breakdown,
    };
  } else if (finalScore >= 55) {
    return {
      score: Math.round(finalScore),
      label: 'Good',
      emoji: '✅',
      color: 'text-blue-400',
      breakdown,
    };
  } else if (finalScore >= 40) {
    return {
      score: Math.round(finalScore),
      label: 'Fair',
      emoji: '⚠️',
      color: 'text-yellow-400',
      breakdown,
    };
  } else if (finalScore >= 25) {
    return {
      score: Math.round(finalScore),
      label: 'Risky',
      emoji: '⚠️',
      color: 'text-orange-400',
      breakdown,
    };
  } else {
    return {
      score: Math.round(finalScore),
      label: 'Avoid',
      emoji: '❌',
      color: 'text-red-400',
      breakdown,
    };
  }
}

export function getMarketValueByCondition(
  condition: string,
  loosePrice: number,
  cibPrice: number,
  newPrice: number,
  gradedPrice: number = 0
): number {
  switch (condition) {
    case 'Loose':
      return loosePrice || cibPrice || newPrice;
    case 'Used':
      return cibPrice || loosePrice || newPrice;
    case 'CIB':
      return cibPrice || loosePrice || newPrice;
    case 'Sealed':
    case 'New':
      return newPrice || cibPrice || loosePrice;
    case 'Graded':
      return gradedPrice || newPrice || cibPrice || loosePrice;
    case 'Damaged':
      return Math.round((loosePrice || cibPrice || newPrice || 0) * 0.5 * 100) / 100;
    case 'Untested':
      return Math.round((loosePrice || cibPrice || newPrice || 0) * 0.6 * 100) / 100;
    default:
      return loosePrice || cibPrice || newPrice;
  }
}

export function calculateSimpleDealScore(
  purchasePrice: number,
  marketValue: number,
  pricingConfidence: number = 100
): SimpleDealScore {
  if (marketValue === 0 || purchasePrice === 0) {
    return {
      score: 0,
      label: 'No Data',
      emoji: '❓',
      color: 'text-gray-400',
    };
  }

  const profitMargin = ((marketValue - purchasePrice) / purchasePrice) * 100;
  const profitAmount = marketValue - purchasePrice;

  let baseScore = 0;
  if (profitMargin >= 300) baseScore = 95;
  else if (profitMargin >= 200) baseScore = 90;
  else if (profitMargin >= 150) baseScore = 85;
  else if (profitMargin >= 100) baseScore = 75;
  else if (profitMargin >= 75) baseScore = 65;
  else if (profitMargin >= 50) baseScore = 55;
  else if (profitMargin >= 30) baseScore = 45;
  else if (profitMargin >= 15) baseScore = 35;
  else if (profitMargin >= 5) baseScore = 25;
  else if (profitMargin >= 0) baseScore = 15;
  else baseScore = 5;

  const absoluteProfitBonus = Math.min(profitAmount / 10, 10);

  const confidencePenalty = ((100 - pricingConfidence) / 100) * 15;

  let finalScore = baseScore + absoluteProfitBonus - confidencePenalty;

  if (profitMargin >= 100 && profitAmount >= 20) {
    finalScore += 5;
  }

  finalScore = Math.max(0, Math.min(100, finalScore));

  if (finalScore >= 85) {
    return {
      score: Math.round(finalScore),
      label: 'Steal',
      emoji: '🔥',
      color: 'text-green-400',
    };
  } else if (finalScore >= 70) {
    return {
      score: Math.round(finalScore),
      label: 'Great',
      emoji: '💎',
      color: 'text-emerald-400',
    };
  } else if (finalScore >= 55) {
    return {
      score: Math.round(finalScore),
      label: 'Good',
      emoji: '✅',
      color: 'text-blue-400',
    };
  } else if (finalScore >= 40) {
    return {
      score: Math.round(finalScore),
      label: 'Fair',
      emoji: '⚠️',
      color: 'text-yellow-400',
    };
  } else if (finalScore >= 25) {
    return {
      score: Math.round(finalScore),
      label: 'Risky',
      emoji: '⚠️',
      color: 'text-orange-400',
    };
  } else {
    return {
      score: Math.round(finalScore),
      label: 'Avoid',
      emoji: '❌',
      color: 'text-red-400',
    };
  }
}

export function shouldSkipReview(
  barcode: string,
  normalizedTitle: string,
  platformNormalized: string,
  condition: string,
  purchasePrice: number,
  pricingStatus: string,
  selectedMarketValue: number,
  pricingConfidence: number
): { skip: boolean; reason: string } {
  if (!barcode || barcode.trim() === '') {
    return { skip: false, reason: 'Missing barcode' };
  }

  if (!normalizedTitle || normalizedTitle.trim() === '') {
    return { skip: false, reason: 'Missing normalized title' };
  }

  if (!platformNormalized || platformNormalized.trim() === '') {
    return { skip: false, reason: 'Missing normalized platform' };
  }

  if (!condition || condition.trim() === '') {
    return { skip: false, reason: 'Missing condition' };
  }

  if (!purchasePrice || purchasePrice <= 0) {
    return { skip: false, reason: 'Missing purchase price' };
  }

  if (pricingStatus !== 'matched' && pricingStatus !== 'found') {
    return { skip: false, reason: 'Pricing status must be matched' };
  }

  if (!selectedMarketValue || selectedMarketValue <= 0) {
    return { skip: false, reason: 'Missing market value' };
  }

  if (pricingConfidence < 80) {
    return { skip: false, reason: 'Pricing confidence too low (< 80%)' };
  }

  return { skip: true, reason: 'All data present and confident' };
}
