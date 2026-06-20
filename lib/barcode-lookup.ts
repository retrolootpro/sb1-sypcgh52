export type ItemType = 'game' | 'console' | 'controller' | 'memory_card' | 'cable' | 'accessory' | 'book' | 'manga' | 'collectible' | 'mixed_lot' | 'unknown';

export type LookupResult = {
  barcode: string;
  title: string;
  normalizedTitle: string;
  brand: string;
  category: string;
  description: string;
  imageUrl: string;
  thumbnailUrl: string;
  itemType: ItemType;
  confidence: number;
  provider: string;
  rawData: any;
};

export type ConfidenceBreakdown = {
  barcodeExactMatch: number;
  titleSimilarity: number;
  platformSimilarity: number;
  itemTypeMatch: number;
  imageMatch: number;
  pricingMatch: number;
  editionMatch: number;
  overall: number;
  explanation: string;
};

export type ClassificationResult = {
  itemType: ItemType;
  confidence: number;
  reasoning: string;
  subtype?: string;
};

export type MatchCandidate = {
  title: string;
  platform?: string;
  score: number;
  reason: string;
  metadata?: any;
};

const GAME_KEYWORDS = [
  'game', 'video game', 'videogame', 'software', 'disc', 'cartridge', 'cart',
  'playstation', 'xbox', 'nintendo', 'switch', 'wii', 'gamecube', 'n64',
  'snes', 'nes', 'sega', 'genesis', 'dreamcast', 'ps1', 'ps2', 'ps3', 'ps4',
  'ps5', 'psp', 'vita', 'ds', '3ds', 'gameboy', 'game boy'
];

const CONSOLE_KEYWORDS = [
  'console', 'system', 'bundle', 'playstation console', 'xbox console',
  'nintendo console', 'gaming system', 'game system', 'handheld system'
];

const CONTROLLER_KEYWORDS = [
  'controller', 'gamepad', 'wireless controller', 'wired controller', 'dualshock',
  'dual shock', 'joycon', 'joy-con', 'pro controller', 'elite controller',
  'fight stick', 'arcade stick', 'racing wheel', 'flight stick', 'joystick'
];

const MEMORY_CARD_KEYWORDS = [
  'memory card', 'memory unit', 'storage', 'hard drive', 'hdd', 'ssd',
  'expansion card', 'memory pak', 'save card', 'flash card'
];

const CABLE_KEYWORDS = [
  'cable', 'cord', 'hdmi', 'av cable', 'component cable', 'composite',
  'power cable', 'ac adapter', 'power supply', 'charging cable', 'usb cable',
  'link cable', 'video cable', 'audio cable', 'scart'
];

const ACCESSORY_KEYWORDS = [
  'adapter', 'headset', 'charger', 'case', 'stylus', 'sensor', 'camera',
  'microphone', 'stand', 'dock', 'grip', 'protective', 'screen protector',
  'carrying case', 'travel case', 'battery pack', 'cooling fan', 'usb hub'
];

const BOOK_KEYWORDS = [
  'book', 'paperback', 'hardcover', 'hardback', 'isbn', 'novel', 'reader',
  'textbook', 'guidebook', 'strategy guide', 'manual', 'author', 'publisher'
];

const MANGA_KEYWORDS = [
  'manga', 'graphic novel', 'comic', 'volume', 'viz media', 'shonen', 'shojo',
  'tokyopop', 'kodansha'
];

const COLLECTIBLE_KEYWORDS = [
  'collectible', 'figure', 'figurine', 'statue', 'trading card', 'card game',
  'pokemon card', 'sports card', 'toy', 'plush', 'sealed box', 'blind box'
];

const MIXED_LOT_KEYWORDS = [
  'lot', 'bundle', 'assortment', 'collection', 'mixed lot', 'bulk'
];

const EDITION_PATTERNS = [
  { pattern: /\bgreatest hits\b/i, edition: 'Greatest Hits' },
  { pattern: /\bplayer'?s choice\b/i, edition: "Player's Choice" },
  { pattern: /\bplatinum hits\b/i, edition: 'Platinum Hits' },
  { pattern: /\bcollector'?s edition\b/i, edition: "Collector's Edition" },
  { pattern: /\blimited edition\b/i, edition: 'Limited Edition' },
  { pattern: /\bspecial edition\b/i, edition: 'Special Edition' },
  { pattern: /\bdeluxe edition\b/i, edition: 'Deluxe Edition' },
  { pattern: /\bgoty\b|game of the year/i, edition: 'Game of the Year' },
  { pattern: /\bcomplete edition\b/i, edition: 'Complete Edition' },
  { pattern: /\bdefinitive edition\b/i, edition: 'Definitive Edition' },
  { pattern: /\bultimate edition\b/i, edition: 'Ultimate Edition' },
  { pattern: /\bbundle\b/i, edition: 'Bundle' },
];

export function normalizeTitle(title: string): string {
  let normalized = title
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  EDITION_PATTERNS.forEach(({ pattern }) => {
    normalized = normalized.replace(pattern, '').trim();
  });

  return normalized;
}

export function detectEdition(title: string): string | null {
  for (const { pattern, edition } of EDITION_PATTERNS) {
    if (pattern.test(title)) {
      return edition;
    }
  }
  return null;
}

export function classifyItem(title: string, category: string, brand: string): ClassificationResult {
  const normalizedText = `${title} ${category} ${brand}`.toLowerCase();

  let gameScore = 0;
  let consoleScore = 0;
  let controllerScore = 0;
  let memoryScore = 0;
  let cableScore = 0;
  let accessoryScore = 0;
  let bookScore = 0;
  let mangaScore = 0;
  let collectibleScore = 0;
  let mixedLotScore = 0;

  GAME_KEYWORDS.forEach(keyword => {
    if (normalizedText.includes(keyword)) gameScore += 2;
  });

  CONSOLE_KEYWORDS.forEach(keyword => {
    if (normalizedText.includes(keyword)) consoleScore += 3;
  });

  CONTROLLER_KEYWORDS.forEach(keyword => {
    if (normalizedText.includes(keyword)) controllerScore += 4;
  });

  MEMORY_CARD_KEYWORDS.forEach(keyword => {
    if (normalizedText.includes(keyword)) memoryScore += 4;
  });

  CABLE_KEYWORDS.forEach(keyword => {
    if (normalizedText.includes(keyword)) cableScore += 4;
  });

  ACCESSORY_KEYWORDS.forEach(keyword => {
    if (normalizedText.includes(keyword)) accessoryScore += 2;
  });

  BOOK_KEYWORDS.forEach(keyword => {
    if (normalizedText.includes(keyword)) bookScore += 3;
  });

  MANGA_KEYWORDS.forEach(keyword => {
    if (normalizedText.includes(keyword)) mangaScore += 4;
  });

  COLLECTIBLE_KEYWORDS.forEach(keyword => {
    if (normalizedText.includes(keyword)) collectibleScore += 3;
  });

  MIXED_LOT_KEYWORDS.forEach(keyword => {
    if (normalizedText.includes(keyword)) mixedLotScore += 4;
  });

  const categoryLower = category.toLowerCase();
  if (categoryLower.includes('video game') || categoryLower.includes('software')) {
    gameScore += 10;
  }
  if (categoryLower.includes('console') || categoryLower.includes('system')) {
    consoleScore += 10;
  }
  if (categoryLower.includes('controller') || categoryLower.includes('gamepad')) {
    controllerScore += 10;
  }
  if (categoryLower.includes('memory') || categoryLower.includes('storage')) {
    memoryScore += 10;
  }
  if (categoryLower.includes('cable') || categoryLower.includes('cord')) {
    cableScore += 10;
  }
  if (categoryLower.includes('accessory') || categoryLower.includes('peripheral')) {
    accessoryScore += 5;
  }
  if (categoryLower.includes('book') || categoryLower.includes('literature')) {
    bookScore += 12;
  }
  if (categoryLower.includes('manga') || categoryLower.includes('comics') || categoryLower.includes('graphic novel')) {
    mangaScore += 12;
  }
  if (categoryLower.includes('collectible') || categoryLower.includes('toy') || categoryLower.includes('trading card')) {
    collectibleScore += 10;
  }
  if (categoryLower.includes('lot') || categoryLower.includes('bundle')) {
    mixedLotScore += 10;
  }

  const scores = [
    { type: 'game' as ItemType, score: gameScore, keyword: 'game' },
    { type: 'console' as ItemType, score: consoleScore, keyword: 'console' },
    { type: 'controller' as ItemType, score: controllerScore, keyword: 'controller' },
    { type: 'memory_card' as ItemType, score: memoryScore, keyword: 'memory card' },
    { type: 'cable' as ItemType, score: cableScore, keyword: 'cable' },
    { type: 'accessory' as ItemType, score: accessoryScore, keyword: 'accessory' },
    { type: 'book' as ItemType, score: bookScore, keyword: 'book' },
    { type: 'manga' as ItemType, score: mangaScore, keyword: 'manga' },
    { type: 'collectible' as ItemType, score: collectibleScore, keyword: 'collectible' },
    { type: 'mixed_lot' as ItemType, score: mixedLotScore, keyword: 'mixed lot' },
  ];

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];

  if (top.score === 0) {
    return {
      itemType: 'unknown',
      confidence: 20,
      reasoning: 'Unable to determine item type from available data',
    };
  }

  return {
    itemType: top.type,
    confidence: Math.min(50 + (top.score * 3), 98),
    reasoning: `Classified as ${top.keyword} (score: ${top.score})`,
  };
}

export function calculateConfidence(params: {
  barcodeMatch: boolean;
  titleSimilarity: number;
  platformMatch: boolean;
  itemTypeConfidence: number;
  hasImage: boolean;
  hasPricing: boolean;
  editionMatch: boolean;
}): ConfidenceBreakdown {
  const barcodeExactMatch = params.barcodeMatch ? 100 : 0;
  const titleSimilarity = params.titleSimilarity;
  const platformSimilarity = params.platformMatch ? 100 : 50;
  const itemTypeMatch = params.itemTypeConfidence;
  const imageMatch = params.hasImage ? 100 : 30;
  const pricingMatch = params.hasPricing ? 100 : 40;
  const editionMatch = params.editionMatch ? 100 : 80;

  const overall = Math.round(
    (barcodeExactMatch * 0.30) +
    (titleSimilarity * 0.25) +
    (platformSimilarity * 0.15) +
    (itemTypeMatch * 0.10) +
    (imageMatch * 0.08) +
    (pricingMatch * 0.07) +
    (editionMatch * 0.05)
  );

  let explanation = '';
  if (overall >= 90) {
    explanation = 'Excellent match - exact barcode and metadata alignment';
  } else if (overall >= 85) {
    explanation = 'High confidence match with strong data alignment';
  } else if (overall >= 70) {
    explanation = 'Good match - minor discrepancies in metadata';
  } else if (overall >= 60) {
    explanation = 'Moderate confidence - review suggested matches';
  } else {
    explanation = 'Low confidence - manual review required';
  }

  return {
    barcodeExactMatch,
    titleSimilarity,
    platformSimilarity,
    itemTypeMatch,
    imageMatch,
    pricingMatch,
    editionMatch,
    overall,
    explanation,
  };
}

export function extractPlatform(title: string): string | null {
  const platformPatterns = [
    { pattern: /\b(playstation 5|ps5)\b/i, platform: 'PlayStation 5' },
    { pattern: /\b(playstation 4|ps4)\b/i, platform: 'PlayStation 4' },
    { pattern: /\b(playstation 3|ps3)\b/i, platform: 'PlayStation 3' },
    { pattern: /\b(playstation 2|ps2)\b/i, platform: 'PlayStation 2' },
    { pattern: /\b(playstation|ps1|psx)\b/i, platform: 'PlayStation' },
    { pattern: /\b(xbox series x)\b/i, platform: 'Xbox Series X/S' },
    { pattern: /\b(xbox series s)\b/i, platform: 'Xbox Series X/S' },
    { pattern: /\b(xbox one x)\b/i, platform: 'Xbox One' },
    { pattern: /\b(xbox one)\b/i, platform: 'Xbox One' },
    { pattern: /\b(xbox 360)\b/i, platform: 'Xbox 360' },
    { pattern: /\b(xbox)\b/i, platform: 'Xbox' },
    { pattern: /\b(nintendo switch|switch)\b/i, platform: 'Switch' },
    { pattern: /\b(wii u)\b/i, platform: 'Wii U' },
    { pattern: /\b(wii)\b/i, platform: 'Wii' },
    { pattern: /\b(gamecube|ngc)\b/i, platform: 'GameCube' },
    { pattern: /\b(n64|nintendo 64)\b/i, platform: 'N64' },
    { pattern: /\b(snes|super nintendo)\b/i, platform: 'SNES' },
    { pattern: /\b(nes|nintendo entertainment system)\b/i, platform: 'NES' },
    { pattern: /\b(3ds|nintendo 3ds)\b/i, platform: '3DS' },
    { pattern: /\b(ds|nintendo ds)\b/i, platform: 'DS' },
    { pattern: /\b(game boy advance|gba)\b/i, platform: 'Game Boy Advance' },
    { pattern: /\b(game boy color|gbc)\b/i, platform: 'Game Boy Color' },
    { pattern: /\b(game boy|gameboy)\b/i, platform: 'Game Boy' },
    { pattern: /\b(ps vita|vita)\b/i, platform: 'PS Vita' },
    { pattern: /\b(psp)\b/i, platform: 'PSP' },
    { pattern: /\b(sega genesis|genesis)\b/i, platform: 'Sega Genesis' },
    { pattern: /\b(dreamcast)\b/i, platform: 'Sega Dreamcast' },
    { pattern: /\b(saturn)\b/i, platform: 'Sega Saturn' },
  ];

  for (const { pattern, platform } of platformPatterns) {
    if (pattern.test(title)) {
      return platform;
    }
  }

  return null;
}

export function calculateTitleSimilarity(title1: string, title2: string): number {
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);

  if (norm1 === norm2) return 100;

  const words1 = norm1.split(' ').filter(w => w.length > 2);
  const words2 = norm2.split(' ').filter(w => w.length > 2);

  if (words1.length === 0 || words2.length === 0) return 0;

  let matchCount = 0;
  words1.forEach(word1 => {
    if (words2.some(word2 => word2.includes(word1) || word1.includes(word2))) {
      matchCount++;
    }
  });

  const matchRatio = matchCount / Math.max(words1.length, words2.length);
  return Math.round(matchRatio * 100);
}

export function rankCandidates(
  searchTitle: string,
  searchPlatform: string | null,
  candidates: any[]
): MatchCandidate[] {
  return candidates
    .map(candidate => {
      const titleSim = calculateTitleSimilarity(searchTitle, candidate.title);
      const platformMatch = searchPlatform && candidate.platform === searchPlatform;
      const editionMatch = detectEdition(searchTitle) === detectEdition(candidate.title);

      let score = titleSim * 0.6;
      if (platformMatch) score += 30;
      if (editionMatch) score += 10;

      let reason = `Title match: ${titleSim}%`;
      if (platformMatch) reason += ', Platform match';
      if (editionMatch) reason += ', Edition match';

      return {
        title: candidate.title,
        platform: candidate.platform,
        score: Math.round(score),
        reason,
        metadata: candidate,
      };
    })
    .sort((a, b) => b.score - a.score);
}
