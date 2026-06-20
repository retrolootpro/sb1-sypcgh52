'use client';

export type CloverCardPaymentRequest = {
  externalId: string;
  amountCents: number;
  amount: number;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  taxRate: number;
  creditUsed: number;
  lines: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
};

export type CloverCardPaymentResult = {
  success: boolean;
  reference?: string;
  paymentId?: string;
  externalId?: string;
  message?: string;
  reason?: string;
};

export type CloverReceiptPayload = {
  saleNumber: string;
  soldAt: string;
  lines: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  creditUsed: number;
  paymentMethod: string;
  processorReference?: string;
};

declare global {
  interface Window {
    RetroLootClover?: {
      isAvailable?: () => boolean;
      sale?: (payload: string) => void;
      printReceipt?: (payload: string) => void;
      openCashDrawer?: () => void;
    };
    __retroLootCloverPaymentResult?: (payload: string) => void;
  }
}

export function isCloverBridgeAvailable() {
  if (typeof window === 'undefined') return false;
  if (!window.RetroLootClover?.sale) return false;
  try {
    return window.RetroLootClover.isAvailable ? Boolean(window.RetroLootClover.isAvailable()) : true;
  } catch {
    return true;
  }
}

export function requestCloverCardPayment(request: CloverCardPaymentRequest, timeoutMs = 120000) {
  return new Promise<CloverCardPaymentResult>((resolve, reject) => {
    if (typeof window === 'undefined' || !window.RetroLootClover?.sale) {
      reject(new Error('Clover hardware bridge is not available. Open POS from the Clover app.'));
      return;
    }

    const previousHandler = window.__retroLootCloverPaymentResult;
    const timeout = window.setTimeout(() => {
      window.__retroLootCloverPaymentResult = previousHandler;
      reject(new Error('Clover payment timed out before approval or decline was received.'));
    }, timeoutMs);

    window.__retroLootCloverPaymentResult = (payload: string) => {
      window.clearTimeout(timeout);
      window.__retroLootCloverPaymentResult = previousHandler;
      try {
        const result = JSON.parse(payload) as CloverCardPaymentResult;
        resolve(result);
      } catch {
        reject(new Error('Clover returned an unreadable payment response.'));
      }
    };

    try {
      window.RetroLootClover.sale(JSON.stringify(request));
    } catch (error) {
      window.clearTimeout(timeout);
      window.__retroLootCloverPaymentResult = previousHandler;
      reject(error instanceof Error ? error : new Error('Could not start Clover payment.'));
    }
  });
}

export function requestCloverReceiptPrint(payload: CloverReceiptPayload) {
  if (typeof window === 'undefined' || !window.RetroLootClover?.printReceipt) return false;
  try {
    window.RetroLootClover.printReceipt(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function requestCloverCashDrawerOpen() {
  if (typeof window === 'undefined' || !window.RetroLootClover?.openCashDrawer) return false;
  try {
    window.RetroLootClover.openCashDrawer();
    return true;
  } catch {
    return false;
  }
}
