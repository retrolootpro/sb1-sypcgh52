export type ScanResult = {
  barcode: string;
  format: string;
  timestamp: number;
};

export type ScannerOptions = {
  onScan: (result: ScanResult) => void;
  onError: (error: Error) => void;
  formats?: string[];
  cooldownMs?: number;
};

export class BarcodeScanner {
  private videoElement: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private animationFrame: number | null = null;
  private lastScannedCode: string | null = null;
  private lastScanTime: number = 0;
  private options: ScannerOptions;
  private barcodeDetector: any = null;
  private zxingReader: any = null;
  private destroyed = false;

  constructor(options: ScannerOptions) {
    this.options = {
      formats: [
        'upc_a',
        'upc_e',
        'ean_13',
        'ean_8',
        'code_128',
      ],
      cooldownMs: 2000,
      ...options,
    };
  }

  async initialize(videoElement: HTMLVideoElement): Promise<void> {
    this.videoElement = videoElement;
    this.destroyed = false;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (this.destroyed) {
        this.stream.getTracks().forEach((t) => t.stop());
        return;
      }

      this.videoElement.srcObject = this.stream;
      await this.videoElement.play();

      if ('BarcodeDetector' in window) {
        this.barcodeDetector = new (window as any).BarcodeDetector({
          formats: this.options.formats,
        });
      } else {
        await this.initializeZXing();
      }
    } catch (error) {
      if (!this.destroyed) {
        this.options.onError(error as Error);
      }
      throw error;
    }
  }

  private async initializeZXing(): Promise<void> {
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      this.zxingReader = new BrowserMultiFormatReader();
    } catch (error) {
      throw new Error('Failed to initialize barcode scanner');
    }
  }

  startScanning(): void {
    if (!this.videoElement) {
      throw new Error('Scanner not initialized');
    }
    this.scan();
  }

  private async scan(): Promise<void> {
    if (this.destroyed) return;
    if (!this.videoElement || this.videoElement.readyState !== this.videoElement.HAVE_ENOUGH_DATA) {
      this.animationFrame = requestAnimationFrame(() => this.scan());
      return;
    }

    try {
      if (this.barcodeDetector) {
        await this.scanWithBarcodeDetector();
      } else if (this.zxingReader) {
        await this.scanWithZXing();
      }
    } catch (error) {
    }

    if (!this.destroyed) {
      this.animationFrame = requestAnimationFrame(() => this.scan());
    }
  }

  private async scanWithBarcodeDetector(): Promise<void> {
    if (this.destroyed) return;
    const barcodes = await this.barcodeDetector.detect(this.videoElement!);
    if (!this.destroyed && barcodes.length > 0) {
      const barcode = barcodes[0];
      this.handleScanResult(barcode.rawValue, barcode.format);
    }
  }

  private async scanWithZXing(): Promise<void> {
    if (this.destroyed) return;
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx || !this.videoElement) return;

      canvas.width = this.videoElement.videoWidth;
      canvas.height = this.videoElement.videoHeight;
      ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = await this.zxingReader.decodeFromImageData(imageData);

      if (!this.destroyed && result) {
        this.handleScanResult(result.getText(), result.getBarcodeFormat().toString());
      }
    } catch (error) {
    }
  }

  private handleScanResult(barcode: string, format: string): void {
    if (this.destroyed) return;
    const now = Date.now();

    if (
      barcode === this.lastScannedCode &&
      now - this.lastScanTime < this.options.cooldownMs!
    ) {
      return;
    }

    this.lastScannedCode = barcode;
    this.lastScanTime = now;

    this.options.onScan({
      barcode,
      format,
      timestamp: now,
    });
  }

  stopScanning(): void {
    this.destroyed = true;

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }

    const stream = this.stream;
    this.stream = null;
    if (stream) {
      setTimeout(() => {
        stream.getTracks().forEach((track) => track.stop());
      }, 0);
    }
  }

  resetCooldown(): void {
    this.lastScannedCode = null;
    this.lastScanTime = 0;
  }
}
