# Review Bypass Rules

**Last Updated:** 2026-03-20

---

## Overview

This document defines the exact criteria for determining whether a scanned item requires manual review or can be added directly to inventory.

---

## Decision Rule

An item is marked **`needs_review = false`** (bypasses manual review) **ONLY** when **ALL** of the following conditions are true:

### ✅ Required Conditions (ALL must be true)

1. **Barcode is present**
   - Must not be null, empty, or whitespace-only
   - Example: `"045496906030"`

2. **Normalized title is present**
   - Must not be null, empty, or whitespace-only
   - Normalized using `normalizeTitle()` function
   - Example: `"mario tennis fever"`

3. **Platform normalized is present**
   - Must not be null, empty, or whitespace-only
   - Example: `"Switch"`, `"PS5"`, `"Xbox Series X"`

4. **Condition is present**
   - Must not be null, empty, or whitespace-only
   - Valid values: `"Loose"`, `"CIB"`, `"New"`
   - For UPC scans, defaults to `"CIB"`

5. **Purchase price is present and > 0**
   - Must be a positive number (> $0.00)
   - Example: `25.00`, `79.99`
   - If user skips price entry → `needs_review = true`

6. **Pricing status = "matched"**
   - Must exactly equal `"matched"` (not `"found"`, `"pending"`, `"error"`, etc.)
   - This indicates high-confidence pricing data was found

7. **Selected market value is present and > 0**
   - Must be a positive number (> $0.00)
   - Calculated based on item condition:
     - CIB → uses `price_cib`
     - Loose → uses `price_loose`
     - New → uses `price_new`
   - Example: `45.99`, `120.00`

8. **Pricing confidence >= 80%**
   - Must be at least 80 (on a 0-100 scale)
   - This is equivalent to 0.8 as a decimal
   - Lower confidence → `needs_review = true`

---

## If ANY Condition Fails

If **ANY** of the above conditions is false, the item is marked:
- **`needs_review = true`**
- Item is still saved to inventory (never blocked)
- Item appears with yellow highlight in inventory table
- User must manually review and complete missing data

---

## Implementation

### Function Signature

```typescript
export function shouldSkipReview(
  barcode: string,
  normalizedTitle: string,
  platformNormalized: string,
  condition: string,
  purchasePrice: number,
  pricingStatus: string,
  selectedMarketValue: number,
  pricingConfidence: number
): { skip: boolean; reason: string }
```

### Location

- **File:** `lib/deal-score.ts`
- **Lines:** 272-315

### Usage

Called during scan workflow after:
1. UPC barcode lookup completes
2. Pricing data retrieved
3. User enters purchase price
4. Deal score calculated

---

## Examples

### ✅ Example 1: Item Bypasses Review

```typescript
shouldSkipReview(
  "045496906030",           // barcode ✅
  "mario tennis fever",      // normalizedTitle ✅
  "Switch",                  // platformNormalized ✅
  "CIB",                     // condition ✅
  25.00,                     // purchasePrice ✅ (> 0)
  "matched",                 // pricingStatus ✅ (exactly "matched")
  45.99,                     // selectedMarketValue ✅ (> 0)
  85                         // pricingConfidence ✅ (>= 80)
)
// Returns: { skip: true, reason: "All data present and confident" }
// Result: needs_review = false, item added directly
```

### ❌ Example 2: Low Confidence → Needs Review

```typescript
shouldSkipReview(
  "045496906030",
  "mario tennis fever",
  "Switch",
  "CIB",
  25.00,
  "matched",
  45.99,
  65                         // ❌ Confidence only 65% (< 80%)
)
// Returns: { skip: false, reason: "Pricing confidence too low (< 80%)" }
// Result: needs_review = true
```

### ❌ Example 3: No Purchase Price → Needs Review

```typescript
shouldSkipReview(
  "045496906030",
  "mario tennis fever",
  "Switch",
  "CIB",
  0,                         // ❌ No purchase price entered
  "matched",
  45.99,
  85
)
// Returns: { skip: false, reason: "Missing purchase price" }
// Result: needs_review = true
```

### ❌ Example 4: Pricing Not Matched → Needs Review

```typescript
shouldSkipReview(
  "045496906030",
  "mario tennis fever",
  "Switch",
  "CIB",
  25.00,
  "found",                   // ❌ Status is "found" not "matched"
  45.99,
  85
)
// Returns: { skip: false, reason: "Pricing status must be matched" }
// Result: needs_review = true
```

### ❌ Example 5: Missing Market Value → Needs Review

```typescript
shouldSkipReview(
  "045496906030",
  "mario tennis fever",
  "Switch",
  "CIB",
  25.00,
  "matched",
  0,                         // ❌ No market value calculated
  85
)
// Returns: { skip: false, reason: "Missing market value" }
// Result: needs_review = true
```

---

## Scan Workflow Integration

### Step-by-Step Flow

1. **User scans barcode**
   - Barcode captured via camera or keyboard

2. **UPC lookup**
   - Queries barcode databases
   - Extracts: title, platform, type, images

3. **Pricing lookup**
   - Queries PriceCharting API
   - Extracts: loose/cib/new prices, confidence

4. **Purchase price dialog appears**
   - User enters what they paid
   - OR clicks "Skip for Now" → `needs_review = true`

5. **Deal score calculation**
   - Market value selected based on condition
   - Profit = market value - purchase price
   - Margin = (profit / purchase price) × 100
   - Deal score: 0-100 with label

6. **Review bypass check (this rule)**
   - Evaluates all 8 conditions
   - Returns skip: true/false + reason

7. **Save to database**
   - If skip = true: `needs_review = false`
   - If skip = false: `needs_review = true`
   - Item saved either way

8. **User feedback**
   - Success toast: Shows deal score
   - Warning toast: Shows reason for review

---

## Previous vs. New Rules

### ❌ Old Rules (Before 2026-03-20)

The old implementation had:
- Inconsistent parameter order
- Accepted both "found" and "matched" pricing status
- Only required 70% confidence threshold
- Additional confidence check in scan workflow (redundant)
- Did not check selected market value explicitly

### ✅ New Rules (Current)

The new implementation has:
- Clear, explicit parameter order
- Only accepts "matched" pricing status (stricter)
- Requires 80% confidence threshold (more strict)
- Checks selected market value > 0
- Single source of truth (no redundant checks)
- Better error messages for each failure case

---

## Database Storage

When an item is saved, these fields are set:

```sql
INSERT INTO inventory_items (
  barcode,                    -- From scan
  raw_scanned_title,          -- From UPC lookup
  platform_normalized,        -- Normalized platform
  condition,                  -- "CIB" for UPC scans
  purchase_price,             -- User-entered
  pricing_status,             -- "matched", "found", "pending", etc.
  selected_market_value,      -- Market value for condition
  estimated_profit,           -- market value - purchase price
  estimated_margin_percent,   -- (profit / cost) × 100
  deal_score,                 -- 0-100
  deal_score_label,           -- "Steal", "Great", etc.
  needs_review,               -- true/false (THIS FIELD)
  pricing_confidence,         -- 0-100
  ...
)
```

---

## UI Indicators

### Inventory Table

Items with `needs_review = true` display:
- 🟨 Yellow row highlight
- ⚠️ Warning icon on thumbnail
- "Review" badge next to product name

### Scan Queue

Items show status:
- ✅ "added" (green) = bypassed review
- ⚠️ "needs_review" (yellow) = requires review

### Toast Notifications

Success (bypassed):
```
✓ Mario Tennis Fever
$25.00 → 💎 Great
```

Warning (needs review):
```
⚠ Mario Tennis Fever - Needs Review
Pricing confidence too low (< 80%)
```

---

## Testing Checklist

To verify the review bypass rules:

### Test 1: Perfect Scan (Should Bypass)
- [ ] Scan valid UPC with good pricing data
- [ ] Enter purchase price (e.g., $25)
- [ ] Verify pricing confidence >= 80%
- [ ] Verify pricing status = "matched"
- [ ] Verify market value > 0
- [ ] Expected: Success toast, no review flag

### Test 2: Low Confidence (Should Review)
- [ ] Scan UPC with poor/fuzzy match (60-79% confidence)
- [ ] Enter purchase price
- [ ] Expected: Warning toast, needs review

### Test 3: No Purchase Price (Should Review)
- [ ] Scan valid UPC
- [ ] Click "Skip for Now" on price dialog
- [ ] Expected: Warning toast "Missing purchase price"

### Test 4: No Pricing Data (Should Review)
- [ ] Scan obscure/unlisted item
- [ ] Pricing lookup fails or returns no data
- [ ] Enter purchase price
- [ ] Expected: Warning toast, needs review

### Test 5: Missing Barcode (Should Review)
- [ ] Manually create item without barcode
- [ ] Expected: needs_review = true

---

## Rationale

### Why These Rules?

**Goal:** Only bypass manual review when we have high-quality, reliable data.

**Rationale for each rule:**

1. **Barcode required** - Ensures traceability and uniqueness
2. **Title required** - Need valid product name for listings/sales
3. **Platform required** - Critical for pricing accuracy
4. **Condition required** - Directly affects market value
5. **Purchase price > 0** - Needed for profit calculations
6. **Status = "matched"** - Only high-confidence matches bypass
7. **Market value > 0** - Can't calculate profit without it
8. **Confidence >= 80%** - Reduces risk of pricing errors

### Impact of Strictness

**More strict rules (current) means:**
- ✅ Higher data quality
- ✅ Fewer pricing errors
- ✅ More reliable profit estimates
- ✅ Better deal score accuracy
- ⚠️ More items flagged for review (initially)

**Over time:**
- Users learn which items scan well
- Pricing database improves coverage
- Review queue shrinks naturally
- Confidence in automated flow increases

---

## Maintenance

### When to Adjust Rules

Consider relaxing rules if:
- Too many good items flagged for review
- Users complain about excessive manual work
- Pricing API becomes more accurate

Consider tightening rules if:
- Seeing frequent pricing errors
- Deal scores are inaccurate
- Items are mislisted due to bad data

### How to Adjust

1. Update `shouldSkipReview()` function in `lib/deal-score.ts`
2. Update this documentation
3. Run `npm run build` to verify
4. Test with various barcode scenarios
5. Monitor review queue over next week

---

## Support

For questions or issues:
- See: `INVENTORY_WORKFLOW_UPGRADE.md`
- See: `VERIFICATION_REPORT.md`
- Check console logs: `[Scan Flow]` messages
- Review database: Check `needs_review` column

---

**Document Version:** 1.0
**Effective Date:** 2026-03-20
**Status:** Active
