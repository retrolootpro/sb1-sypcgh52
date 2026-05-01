'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { BarcodeScanner, ScanResult } from '@/lib/barcode-scanner';
import { Camera, X, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';

type BarcodeScannerViewProps = {
  onScan: (result: ScanResult) => void;
  isActive: boolean;
  onStop: () => void;
  soundEnabled?: boolean;
};

export function BarcodeScannerView({
  onScan,
  isActive,
  onStop,
  soundEnabled = true,
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
              <span className="text-white font-medium">Scanning Barcode...</span>
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
