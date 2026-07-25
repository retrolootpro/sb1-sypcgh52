import {
  addCloverInventoryCount,
  adjustCloverInventoryCount,
  createCloverItem,
  findCloverItemBySkuOrBarcode,
  getCloverItem,
  updateCloverItem,
  type CloverItemPayload,
} from '@/lib/server/clover-client';
import { buildItemBusinessPlan } from '@/lib/business-rules';

type InventoryItem = {
  id: string;
  user_id: string;
  product_name: string;
  console?: string | null;
  category?: string | null;
  barcode?: string | null;
  sku?: string | null;
  quantity?: number | null;
  status?: string | null;
  sell_price?: number | null;
  selected_market_value?: number | null;
  price_loose?: number | null;
  price_cib?: number | null;
  price_new?: number | null;
  price_graded?: number | null;
  condition?: string | null;
  clover_item_id?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
};

export type CloverConflictAction = 'create_additional' | 'update_existing' | 'skip';

function priceForItem(item: InventoryItem) {
  const askPrice = buildItemBusinessPlan(item).pricePlan.recommendedAskingPrice;
  if (askPrice > 0) return askPrice;
  const explicit = Number(item.sell_price) || Number(item.selected_market_value) || 0;
  if (explicit > 0) return explicit;
  const condition = String(item.condition || '').toLowerCase();
  if (condition === 'cib') return Number(item.price_cib) || 0;
  if (condition === 'new' || condition === 'sealed') return Number(item.price_new) || 0;
  if (condition === 'graded') return Number(item.price_graded) || 0;
  return Number(item.price_loose) || 0;
}

function fallbackSku(item: InventoryItem) {
  return item.barcode?.trim() || item.sku?.trim() || `RLP-${item.id.slice(0, 8).toUpperCase()}`;
}

function upcForItem(item: InventoryItem) {
  return item.barcode?.trim() || null;
}

function imageForItem(item: InventoryItem) {
  return item.image_url?.trim() || item.thumbnail_url?.trim() || null;
}

export function mapInventoryItemToClover(item: InventoryItem): CloverItemPayload {
  const price = priceForItem(item);
  const upc = upcForItem(item);
  if (!item.product_name?.trim()) throw new Error('Item title is required before syncing to Clover.');
  if (price <= 0) throw new Error('Sell price or market value is required before syncing to Clover.');

  return {
    name: item.product_name.trim().slice(0, 127),
    price: Math.round(price * 100),
    sku: fallbackSku(item),
    code: upc || fallbackSku(item),
    hidden: false,
    available: !['sold', 'archived', 'deleted'].includes(String(item.status || 'available').toLowerCase()),
  };
}

export async function logCloverSync(admin: any, input: {
  userId?: string | null;
  inventoryItemId?: string | null;
  cloverItemId?: string | null;
  cloverEventId?: string | null;
  action: string;
  status: 'pending' | 'synced' | 'failed' | 'skipped';
  requestSummary?: unknown;
  responseSummary?: unknown;
  errorMessage?: string | null;
}) {
  await admin.from('clover_sync_logs').insert({
    user_id: input.userId || null,
    inventory_item_id: input.inventoryItemId || null,
    clover_item_id: input.cloverItemId || null,
    clover_event_id: input.cloverEventId || null,
    action: input.action,
    status: input.status,
    request_summary: input.requestSummary || {},
    response_summary: input.responseSummary || {},
    error_message: input.errorMessage || null,
  });
}

export async function syncInventoryItemToClover(admin: any, item: InventoryItem, options: { conflictAction?: CloverConflictAction } = {}) {
  const payload = mapInventoryItemToClover(item);
  let action = item.clover_item_id ? 'update_item' : 'create_item';

  try {
    const existing = item.clover_item_id || options.conflictAction === 'create_additional'
      ? null
      : await findCloverItemBySkuOrBarcode(payload.sku, payload.code);
    if (existing && !options.conflictAction) {
      return { conflict: true, existingCloverItemId: existing.id, payload };
    }
    if (existing && options.conflictAction === 'skip') {
      await logCloverSync(admin, {
        userId: item.user_id,
        inventoryItemId: item.id,
        cloverItemId: existing.id,
        action: 'conflict_skip',
        status: 'skipped',
        requestSummary: { sku: payload.sku, code: payload.code },
      });
      return { skipped: true, cloverItemId: existing.id, action: 'conflict_skip' };
    }
    const cloverItemId = item.clover_item_id || (options.conflictAction === 'update_existing' ? existing?.id : null);
    if (!item.clover_item_id && cloverItemId) action = 'update_existing_match';
    const shouldAddQuantityToExistingMatch = action === 'update_existing_match';
    const result = cloverItemId ? await updateCloverItem(cloverItemId, payload) : await createCloverItem(payload);
    const finalCloverItemId = cloverItemId || result.id;
    const verifiedItem = await getCloverItem(finalCloverItemId);
    const expectedUpc = upcForItem(item);
    const cloverCode = String(verifiedItem.code || '').trim();
    const upcSynced = expectedUpc ? cloverCode === expectedUpc : false;
    const imageUrl = imageForItem(item);
    const imageSyncStatus = imageUrl ? 'unsupported' : 'not_provided';
    const imageMessage = imageUrl
      ? 'Clover standard Inventory API does not expose item image sync; the image remains in RetroLootPro.'
      : 'No RetroLootPro image is available to sync.';
    let stockSync: { mode: 'set' | 'add'; previousQuantity?: number; addedQuantity: number; finalQuantity: number } | null = null;

    if (finalCloverItemId && Number(item.quantity) >= 0) {
      try {
        const quantity = Number(item.quantity) || 0;
        if (shouldAddQuantityToExistingMatch) {
          const result = await addCloverInventoryCount(finalCloverItemId, quantity);
          stockSync = { mode: 'add', ...result };
        } else {
          await adjustCloverInventoryCount(finalCloverItemId, quantity);
          stockSync = { mode: 'set', addedQuantity: quantity, finalQuantity: quantity };
        }
      } catch {
        // Clover stock endpoints vary by merchant/app permission; item sync still succeeds.
      }
    }

    await admin
      .from('inventory_items')
      .update({
        clover_item_id: finalCloverItemId,
        clover_synced_at: new Date().toISOString(),
        clover_sync_status: 'synced',
        clover_sync_error: null,
        sku: item.sku || payload.sku,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id);

    await logCloverSync(admin, {
      userId: item.user_id,
      inventoryItemId: item.id,
      cloverItemId: finalCloverItemId,
      action,
      status: 'synced',
      requestSummary: { name: payload.name, price: payload.price, sku: payload.sku, code: payload.code, imageUrl },
      responseSummary: {
        id: finalCloverItemId,
        code: cloverCode,
        upcSynced,
        imageSyncStatus,
        imageMessage,
        stockSync,
      },
    });

    return {
      cloverItemId: finalCloverItemId,
      action,
      upc: expectedUpc,
      cloverCode,
      upcSynced,
      imageSyncStatus,
      imageMessage,
      stockSync,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Clover sync failed';
    await admin
      .from('inventory_items')
      .update({ clover_sync_status: 'failed', clover_sync_error: message, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    await logCloverSync(admin, {
      userId: item.user_id,
      inventoryItemId: item.id,
      cloverItemId: item.clover_item_id || null,
      action,
      status: 'failed',
      requestSummary: { name: payload.name, sku: payload.sku, code: payload.code },
      errorMessage: message,
    });
    throw error;
  }
}
