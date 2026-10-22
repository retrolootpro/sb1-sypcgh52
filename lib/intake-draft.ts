import { z } from 'zod';

export const INTAKE_SESSION_KEY = 'retroloot-intake-session';
const pendingBarcode = z.object({
  barcode: z.string().min(1), scannedAt: z.number().finite(),
  scanCount: z.number().int().positive().max(100000).optional(),
});
const queueItem = z.object({
  id: z.string().min(1), barcode: z.string(),
  status: z.enum(['scanning', 'looking_up', 'pricing', 'awaiting_price', 'calculating', 'added', 'needs_review', 'failed']),
  scannedAt: z.number().finite(), scanCount: z.number().int().positive().max(100000).optional(),
  duplicateSessionScan: z.boolean().optional(), productName: z.string().optional(),
  result: z.object({
    title: z.string(),
    classification: z.object({ itemType: z.string() }).passthrough(),
    confidence: z.object({ overall: z.number().finite() }).passthrough(),
  }).passthrough().optional(), error: z.string().optional(),
  purchasePrice: z.number().finite().nonnegative().optional(), selectedConsole: z.string().optional(),
  inventoryItemId: z.string().uuid().optional(), dealScore: z.record(z.unknown()).optional(),
  duplicateMatches: z.array(z.object({
    id: z.string(), product_name: z.string(), console: z.string().nullable(),
    condition: z.string().nullable(), created_at: z.string().nullable(),
  })).optional(),
});
export const intakeDraftSchema = z.object({
  accountId: z.string().uuid(), staffId: z.string().uuid(),
  selectedLotId: z.string(), selectedEmployeeId: z.string().nullable(),
  scanMode: z.enum(['single', 'continuous']), intakeItemType: z.enum(['game', 'book', 'mixed']),
  batchMode: z.boolean(), pendingBarcodes: z.array(pendingBarcode), queue: z.array(queueItem),
  manualBarcode: z.string(), manualTitle: z.string(), manualPlatform: z.string(), savedAt: z.string().datetime(),
});
export type IntakeSessionDraft = z.infer<typeof intakeDraftSchema>;

export function readIntakeDraft(raw: string, accountId: string, staffId: string): IntakeSessionDraft {
  const draft = intakeDraftSchema.parse(JSON.parse(raw));
  if (draft.accountId !== accountId || draft.staffId !== staffId) throw new Error('This intake draft belongs to another staff session.');
  return {
    ...draft,
    queue: draft.queue.map(item => ['scanning', 'looking_up', 'pricing', 'calculating'].includes(item.status)
      ? { ...item, status: 'failed', error: 'This operation was interrupted. Check inventory before scanning again; the save outcome may be unknown.' }
      : item),
  };
}
