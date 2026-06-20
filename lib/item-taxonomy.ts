import { MEDIA_PLATFORMS } from './constants';

export type InventoryFamily = 'games' | 'books_media' | 'collectibles' | 'other';
export type UPCLookupMode = 'auto' | 'book' | 'game';

type ItemLike = {
  product_name?: string | null;
  title?: string | null;
  console?: string | null;
  platform?: string | null;
  category?: string | null;
  item_type?: string | null;
  source_metadata_provider?: string | null;
  source_upc_provider?: string | null;
};

const MEDIA_PLATFORM_SET = new Set(MEDIA_PLATFORMS.map((value) => value.toLowerCase()));

function normalize(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

export function isBookLikeValue(value?: string | null) {
  const text = normalize(value);
  if (!text) return false;
  return MEDIA_PLATFORM_SET.has(text)
    || /\b(book|books|manga|comic|comics|graphic novel|strategy guide|isbn|paperback|hardcover|publisher)\b/i.test(text);
}

export function isBookLikeItem(item: ItemLike) {
  return [
    item.console,
    item.platform,
    item.category,
    item.item_type,
    item.source_metadata_provider,
    item.source_upc_provider,
    item.product_name,
    item.title,
  ].some(isBookLikeValue);
}

export function getInventoryFamily(item: ItemLike): InventoryFamily {
  const text = [
    item.console,
    item.platform,
    item.category,
    item.item_type,
    item.product_name,
    item.title,
  ].map((value) => normalize(value)).join(' ');

  if (isBookLikeItem(item)) return 'books_media';
  if (/\b(collectible|figure|figurine|statue|trading card|toy|plush)\b/.test(text)) return 'collectibles';
  if (/\b(game|console|controller|accessory|cable|memory card|playstation|xbox|nintendo|switch|wii|gamecube|sega|ps[1-5]?)\b/.test(text)) {
    return 'games';
  }
  return 'other';
}

export function supportsAutomatedGamePricing(item: ItemLike) {
  return !isBookLikeItem(item) && getInventoryFamily(item) === 'games';
}

export function lookupModeForItem(item: ItemLike): UPCLookupMode {
  return isBookLikeItem(item) ? 'book' : 'auto';
}

export function defaultConditionForPlatform(platform?: string | null) {
  return isBookLikeValue(platform) ? 'Loose' : 'CIB';
}

export function productTypeLabel(family: InventoryFamily) {
  switch (family) {
    case 'books_media':
      return 'Books & Media';
    case 'collectibles':
      return 'Collectibles';
    case 'games':
      return 'Games';
    default:
      return 'Other';
  }
}
