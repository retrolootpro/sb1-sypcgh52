'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { BarcodeScanner, type ScanResult } from '@/lib/barcode-scanner';
import { Camera, X, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';

export type { ScanResult } from '@/lib/barcode-scanner';

type BarcodeScannerViewProps = {
  onScan: (result: ScanResult) => void;
  isActive: boolean;
  onStop: () => void;
  soundEnabled?: boolean;
  variant?: 'fullscreen' | 'compact';
  title?: string;
};

export function BarcodeScannerView({
  onScan,
  isActive,
  onStop,
  soundEnabled = true,
  variant = 'compact',
  title = 'Scanning Barcode...',
}: BarcodeScannerViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<BarcodeScanner | null>(null);
  const onScanRef = useRef(onScan);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sound, setSound] = useState(soundEnabled);
  const soundRef = useRef(sound);

  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  const playBeep = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch {}
  }, []);

  const cleanup = useCallback(() => {
    if (scannerRef.current) {
      scannerRef.current.stopScanning();
      scannerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isActive) {
      cleanup();
      return;
    }

    if (scannerRef.current) return;

    let cancelled = false;

    const init = async () => {
      if (!videoRef.current) return;
      setIsInitializing(true);
      setError(null);

      try {
        const scanner = new BarcodeScanner({
          onScan: (result) => {
            if (soundRef.current) playBeep();
            if (navigator.vibrate) navigator.vibrate(100);
            onScanRef.current(result);
          },
          onError: (err) => {
            setError(err.message);
            toast.error('Scanner error: ' + err.message);
          },
          cooldownMs: 2000,
        });

        if (cancelled) return;
        await scanner.initialize(videoRef.current);
        if (cancelled) {
          scanner.stopScanning();
          return;
        }
        scanner.startScanning();
        scannerRef.current = scanner;
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to access camera');
          toast.error('Camera access denied or not available');
        }
      } finally {
        if (!cancelled) setIsInitializing(false);
      }
    };

    init();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [isActive, cleanup, playBeep]);

  const handleStop = useCallback(() => {
    cleanup();
    onStop();
  }, [cleanup, onStop]);

  if (!isActive) return null;

  if (variant === 'compact') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md overflow-hidden rounded-xl border border-primary/25 bg-neutral-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-primary" />
              <span className="font-semibold text-white">{title}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSound((s) => !s)}
                className="text-white hover:bg-white/10"
              >
                {sound ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStop}
                className="text-white hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="relative aspect-[4/3] bg-black">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              playsInline
              muted
            />

            <div className="absolute inset-0 flex items-center justify-center p-5">
              <div className="relative h-44 w-72 max-w-full rounded-lg border-2 border-primary/80 bg-black/10">
                <div className="absolute -left-0.5 -top-0.5 h-9 w-9 rounded-tl-lg border-l-4 border-t-4 border-primary" />
                <div className="absolute -right-0.5 -top-0.5 h-9 w-9 rounded-tr-lg border-r-4 border-t-4 border-primary" />
                <div className="absolute -bottom-0.5 -left-0.5 h-9 w-9 rounded-bl-lg border-b-4 border-l-4 border-primary" />
                <div className="absolute -bottom-0.5 -right-0.5 h-9 w-9 rounded-br-lg border-b-4 border-r-4 border-primary" />
                <div className="absolute inset-x-5 top-1/2 h-0.5 -translate-y-1/2 bg-primary/80 shadow-[0_0_18px_hsl(148_100%_50%/0.75)]" />
              </div>
            </div>

            {isInitializing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="text-center">
                  <div className="mx-auto mb-3 h-9 w-9 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <p className="text-sm text-white/70">Initializing camera...</p>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-white/10 px-4 py-3 text-center text-sm text-white/65">
            Position the UPC inside the green box.
            {error && <div className="mt-2 text-red-400">{error}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <div className="relative h-full w-full">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
        />

        <div className="absolute inset-0 flex flex-col">
          <div className="flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
            <div className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-white" />
              <span className="text-white font-medium">{title}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSound((s) => !s)}
                className="text-white hover:bg-white/20"
              >
                {sound ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStop}
                className="text-white hover:bg-white/20"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-4">
            <div className="relative">
              <div className="w-64 h-40 border-2 border-primary/70 rounded-lg">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="h-0.5 w-full bg-primary/60 animate-pulse" />
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 bg-gradient-to-t from-black/80 to-transparent">
            <p className="text-center text-white/70 text-sm">
              Position the barcode within the frame
            </p>
            {error && (
              <p className="mt-3 text-center text-sm text-red-400">{error}</p>
            )}
          </div>
        </div>

        {isInitializing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="text-center">
              <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent mx-auto mb-4" />
              <p className="text-white/70 text-sm">Initializing camera...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
