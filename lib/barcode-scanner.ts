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

const NATIVE_FORMATS = ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128'];
const ZXING_FORMATS = ['UPC_A', 'UPC_E', 'EAN_13', 'EAN_8', 'CODE_128'];

export class BarcodeScanner {
  private videoElement: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private animationFrame: number | null = null;
  private lastScannedCode: string | null = null;
  private lastScanTime: number = 0;
  private options: ScannerOptions;
  private barcodeDetector: any = null;
  private zxingReader: any = null;
  private zxingControls: any = null;
  private destroyed = false;

  constructor(options: ScannerOptions) {
    this.options = {
      formats: NATIVE_FORMATS,
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

      await this.initializeZXing();
      await this.initializeBarcodeDetector();
    } catch (error) {
      if (!this.destroyed) {
        this.options.onError(error as Error);
      }
      throw error;
    }
  }

  private async initializeBarcodeDetector(): Promise<void> {
    const BarcodeDetector = (window as any).BarcodeDetector;
    if (!BarcodeDetector) return;

    try {
      const supportedFormats = typeof BarcodeDetector.getSupportedFormats === 'function'
        ? await BarcodeDetector.getSupportedFormats()
        : this.options.formats;
      const requestedFormats = this.options.formats ?? NATIVE_FORMATS;
      const usableFormats = requestedFormats.filter((format) => supportedFormats.includes(format));

      if (usableFormats.length === 0) return;

      this.barcodeDetector = new BarcodeDetector({ formats: usableFormats });
    } catch {
      this.barcodeDetector = null;
    }
  }

  private async initializeZXing(): Promise<void> {
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');
      const possibleFormats = ZXING_FORMATS
        .map((format) => (BarcodeFormat as any)[format])
        .filter((format) => typeof format === 'number');
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, possibleFormats);
      hints.set(DecodeHintType.TRY_HARDER, true);

      this.zxingReader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 120,
        delayBetweenScanSuccess: this.options.cooldownMs,
      });
    } catch (error) {
      throw new Error('Failed to initialize barcode scanner');
    }
  }

  startScanning(): void {
    if (!this.videoElement) {
      throw new Error('Scanner not initialized');
    }
    if (this.zxingReader) {
      this.startZXingContinuousScan();
      return;
    }
    this.scan();
  }

  private async startZXingContinuousScan(): Promise<void> {
    if (!this.videoElement || !this.stream || !this.zxingReader || this.destroyed) return;

    try {
      this.zxingControls = await this.zxingReader.decodeFromStream(
        this.stream,
        this.videoElement,
        (result: any, error: unknown) => {
          if (this.destroyed || !result) return;
          this.handleScanResult(result.getText(), result.getBarcodeFormat().toString());
        }
      );
    } catch (error) {
      if (this.barcodeDetector && !this.destroyed) {
        this.scan();
        return;
      }

      if (!this.destroyed) {
        this.options.onError(error as Error);
      }
    }
  }

  private async scan(): Promise<void> {
    if (this.destroyed) return;
    if (!this.videoElement || this.videoElement.readyState !== this.videoElement.HAVE_ENOUGH_DATA) {
      this.animationFrame = requestAnimationFrame(() => this.scan());
      return;
    }

    try {
      if (this.barcodeDetector) await this.scanWithBarcodeDetector();
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

    if (this.zxingControls) {
      this.zxingControls.stop();
      this.zxingControls = null;
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
