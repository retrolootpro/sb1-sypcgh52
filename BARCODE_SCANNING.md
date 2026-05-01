# Barcode Scanning Implementation Guide

## Overview

RetroLoot Pro now includes comprehensive barcode scanning capabilities for video game inventory intake. This document explains the architecture, data flow, and extension points.

## Architecture

### Core Components

1. **BarcodeScanner** (`lib/barcode-scanner.ts`)
   - Low-level camera interface and barcode detection
   - Supports native BarcodeDetector API (Chrome/Edge) and ZXing fallback
   - Handles duplicate scan prevention with configurable cooldowns
   - Provides callbacks for successful scans and errors

2. **BarcodeScannerView** (`components/barcode-scanner-view.tsx`)
   - Full-screen camera UI component
   - Shows targeting overlay and scan feedback
   - Supports sound and vibration feedback
   - Mobile-optimized with camera controls

3. **Scan Page** (`app/scan/page.tsx`)
   - Main scanning interface with single/continuous modes
   - Processing queue for scanned items
   - Manual barcode entry option
   - Real-time status updates

4. **Review Queue** (`app/review/page.tsx`)
   - Manual review interface for low-confidence matches
   - Item editing and approval workflow
   - Bulk rejection capabilities

## Data Flow

### Barcode Scan Pipeline

```
1. Scan Barcode
   ↓
2. Check Cache (barcode_lookup_cache table)
   ↓
3. UPC Lookup (if not cached)
   - Provider: UPCitemdb, Barcode Lookup, etc.
   - Returns: title, brand, category, description, image
   ↓
4. Classification
   - Determine item type: game, console, accessory, unknown
   - Extract platform from title
   - Calculate classification confidence
   ↓
5. Metadata Matching (for games)
   - Fuzzy title matching
   - Platform-aware matching
   - Candidate ranking
   ↓
6. Pricing Integration
   - Use existing PriceCharting logic
   - Pull loose/CIB/new prices
   - Select default based on condition
   ↓
7. Confidence Scoring
   - Barcode exact match: 25%
   - Title similarity: 25%
   - Platform match: 15%
   - Item type confidence: 15%
   - Image availability: 10%
   - Pricing match: 10%
   ↓
8. Decision
   - ≥85% confidence: Auto-add to inventory
   - 60-84% confidence: Send to review queue
   - <60% confidence: Manual review required
```

## Database Schema

### New Tables

**scan_sessions**
- Tracks barcode scanning sessions
- Supports single and continuous modes
- Status: active, paused, completed, cancelled

**scan_queue_items**
- Individual scanned items
- Links to scan session
- Tracks processing status
- Stores lookup results

**review_queue**
- Items requiring manual review
- Stores candidate matches
- Confidence scores and reasoning
- Approval/rejection workflow

**barcode_lookup_cache**
- Caches UPC lookup results
- Reduces API calls
- Configurable expiration
- Shared across users for efficiency

### Extended Fields on inventory_items

```typescript
normalized_title: string        // Cleaned title for matching
item_type: string              // game, console, accessory, unknown
brand: string                  // Manufacturer/publisher
region: string                 // Geographic region
variant: string                // Special edition info
source_upc_provider: string    // Which UPC service provided data
source_metadata_provider: string // Game metadata source
source_image_provider: string  // Image source
confidence_score: number       // Match confidence 0-100
raw_lookup_payload: jsonb      // Original API response
scan_created_at: timestamptz   // When item was scanned
pricing_source_notes: string   // Pricing data notes
thumbnail_url: string          // Small preview image
```

## Provider Integration Points

### 1. UPC Lookup Provider

**Current Implementation:** Mock data in `app/scan/page.tsx`

**Integration Steps:**
1. Add provider API key to settings
2. Create provider service in `lib/providers/upc-provider.ts`
3. Implement provider interface:

```typescript
interface UPCProvider {
  lookup(barcode: string): Promise<LookupResult>;
  testConnection(): Promise<boolean>;
}
```

**Recommended Providers:**
- UPCitemdb (https://upcdatabase.org)
- Barcode Lookup (https://www.barcodelookup.com)
- EANDATA (https://eandata.com)

### 2. Metadata Provider

**Current Implementation:** Classification only

**Integration Steps:**
1. Create provider service in `lib/providers/metadata-provider.ts`
2. Implement game database matching:

```typescript
interface MetadataProvider {
  searchGames(title: string, platform?: string): Promise<GameMatch[]>;
  getGameById(id: string): Promise<GameDetails>;
}
```

**Recommended Providers:**
- IGDB (https://www.igdb.com/api)
- GiantBomb API
- Custom PriceCharting integration

### 3. Image Provider

**Current Implementation:** Uses images from UPC provider

**Extension Points:**
- Fallback to metadata provider images
- Custom image upload
- Box art scraping services

## Confidence Scoring System

### Scoring Breakdown

The confidence score is calculated from multiple factors:

```typescript
confidence =
  (barcodeExactMatch * 0.25) +
  (titleSimilarity * 0.25) +
  (platformSimilarity * 0.15) +
  (itemTypeMatch * 0.15) +
  (imageMatch * 0.10) +
  (pricingMatch * 0.10)
```

### Threshold Configuration

**Auto-Add Threshold (Default: 85%)**
- Items above this are automatically added to inventory
- Configurable in settings

**Review Threshold (Default: 60%)**
- Items between this and auto-add go to review queue
- Allows manual verification

**Manual Review (Below Review Threshold)**
- Low confidence items
- Require manual data entry or search

## Classification System

### Item Type Detection

The system classifies items using keyword matching:

**Game Keywords:**
- Platform names (PlayStation, Xbox, Nintendo, etc.)
- Game-specific terms
- Category analysis

**Console Keywords:**
- "console", "system", "handheld"
- Platform-specific console terms

**Accessory Keywords:**
- "controller", "memory card", "cable", "headset"
- Peripheral terms

### Platform Extraction

Automatically extracts platform from title using regex patterns:
- "PS5" → PlayStation 5
- "Xbox Series X" → Xbox Series X/S
- "Switch" → Nintendo Switch
- 30+ platform patterns supported

## Settings Configuration

### API Keys

**UPC Provider Key**
- Required for barcode scanning
- Stored securely server-side
- Validated on save

**PriceCharting Key**
- Used for existing pricing features
- Also used for scanned items

### Scan Behavior

**Duplicate Cooldown (Default: 2s)**
- Prevents rapid re-scanning same code
- Configurable: 1s, 2s, 3s, 5s

**Auto-Add Threshold (Default: 85%)**
- Confidence level for automatic inventory addition
- Options: 80%, 85%, 90%, 95%

**Review Threshold (Default: 60%)**
- Minimum confidence for review queue
- Options: 50%, 60%, 70%

**Feedback Options**
- Sound: Beep on successful scan
- Vibration: Haptic feedback (mobile)

## Mobile Optimization

### Camera Access

- Requests rear camera by default (`facingMode: 'environment'`)
- Full HD resolution (1920x1080) for better accuracy
- Graceful fallback if camera unavailable

### UI Considerations

- Full-screen scanner overlay
- Large touch targets
- Minimal interface during scanning
- Quick undo for mistakes

### Performance

- Barcode detection runs at 60fps when possible
- Automatic frame throttling on low-end devices
- Efficient memory management

## Extension Examples

### Custom UPC Provider

```typescript
// lib/providers/custom-upc-provider.ts
import { LookupResult } from '@/lib/barcode-lookup';

export class CustomUPCProvider {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.example.com';
  }

  async lookup(barcode: string): Promise<LookupResult> {
    const response = await fetch(
      `${this.baseUrl}/lookup/${barcode}`,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      }
    );

    const data = await response.json();

    return {
      barcode,
      title: data.title,
      normalizedTitle: normalizeTitle(data.title),
      brand: data.brand,
      category: data.category,
      description: data.description,
      imageUrl: data.image,
      thumbnailUrl: data.thumbnail,
      itemType: 'unknown', // Will be classified
      confidence: 0, // Will be calculated
      provider: 'custom',
      rawData: data,
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/test`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
```

### Custom Confidence Modifier

```typescript
// lib/confidence-modifiers.ts
export function applyCustomModifiers(
  baseConfidence: ConfidenceBreakdown,
  item: any
): ConfidenceBreakdown {
  let adjusted = { ...baseConfidence };

  // Boost confidence for verified brands
  if (['Nintendo', 'Sony', 'Microsoft'].includes(item.brand)) {
    adjusted.overall = Math.min(100, adjusted.overall + 5);
  }

  // Reduce confidence for common false positives
  if (item.category.includes('DVD') || item.category.includes('Music')) {
    adjusted.overall = Math.max(0, adjusted.overall - 10);
  }

  return adjusted;
}
```

## Troubleshooting

### Camera Not Working

1. Check browser permissions
2. Verify HTTPS connection (required for camera access)
3. Test on different browser (Chrome/Edge recommended)
4. Check console for BarcodeDetector support

### Low Match Rates

1. Verify UPC provider API key is valid
2. Check barcode_lookup_cache table for cached results
3. Review classification rules in `lib/barcode-lookup.ts`
4. Adjust confidence thresholds in settings

### Performance Issues

1. Reduce camera resolution in scanner settings
2. Clear barcode_lookup_cache periodically
3. Enable caching for repeated lookups
4. Optimize database queries with proper indexes

## Future Enhancements

- [ ] Bulk CSV import for batch barcode processing
- [ ] Barcode printing/label generation
- [ ] Mobile app with native camera integration
- [ ] AI-powered image recognition for loose cartridges
- [ ] Multi-language UPC databases
- [ ] Offline scanning with sync
- [ ] Barcode history and analytics
- [ ] Duplicate detection across inventory
- [ ] Integration with shipping label services
- [ ] Custom classification rule builder

## Support

For issues or questions:
1. Check database migration status
2. Review browser console for errors
3. Verify API keys in settings
4. Test with known working barcodes
5. Check RLS policies if data not appearing
