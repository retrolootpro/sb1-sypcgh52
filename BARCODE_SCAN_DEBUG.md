# Barcode Scanning Error Debugging Guide

## Issue

When scanning barcode `013388933044`, the system returns:
```
FunctionsHttpError: Edge Function returned a non-2xx status code
```

## Debugging Improvements Made

### 1. Enhanced Error Logging (`lib/api-services.ts`)

Added comprehensive logging to capture exactly what's happening:

```typescript
console.log('Full response - data:', data);
console.log('Full response - error:', error);
console.log('Error from response data:', errorMessage);
console.log('Final error message:', errorMessage);
```

### 2. Better Error Message Extraction

The code now properly extracts error messages from:
- The `data` field (where Supabase puts error response bodies)
- The `error.message` field
- Nested error structures

### 3. More Specific Error Messages

The system now distinguishes between:
- **API key not configured**: "Please add a PriceCharting, Barcode Lookup, or UPCitemDB API key in Settings"
- **Product not found**: "Product not found for barcode X. This barcode may not exist in the lookup databases"
- **Authentication failed**: "Please try logging out and back in"
- **General errors**: Shows the actual error message from the API

## How to Debug This Specific Error

### Step 1: Check Console Logs

After the improvements, when you scan a barcode, you'll now see detailed logs:

```
Looking up barcode: 013388933044
Full response - data: { error: "Product not found in any database", details: "...", providers_tried: [...] }
Full response - error: { ... }
Error from response data: Product not found in any database
Final error message: Product not found in any database
```

### Step 2: Identify the Root Cause

Based on the console output, you'll see one of these scenarios:

#### Scenario A: "API key not configured"
**Cause**: No API keys in Settings
**Solution**:
1. Go to Settings
2. Add at least one of: PriceCharting, Barcode Lookup, or UPCitemDB API key
3. Click "Test" to verify it works

#### Scenario B: "Product not found in any database"
**Cause**: The barcode doesn't exist in any of the lookup services
**Details**: The `details` field will show which providers were tried and what they returned
**Solution**:
- This barcode may not be in the databases
- Try a different barcode (known video game)
- The item may need to be added manually

#### Scenario C: "Authentication failed"
**Cause**: Session expired or invalid
**Solution**: Log out and log back in

#### Scenario D: Provider-specific errors
**Cause**: Individual API providers returning errors
**Details**: The error message will include provider-specific details
**Solution**: Check API key validity, rate limits, account status

## Understanding the Barcode Lookup Flow

### 1. User scans barcode → `013388933044`

### 2. System calls Edge Function `lookup-upc`
- Authenticates user
- Queries database for API keys:
  ```sql
  SELECT * FROM user_api_keys
  WHERE user_id = 'xxx'
  AND provider IN ('pricecharting', 'upc_lookup', 'barcode_lookup')
  AND status = 'active'
  ```

### 3. System tries providers in order:
1. **PriceCharting** (best for video games)
   - API: `https://www.pricecharting.com/api/product?t=KEY&upc=BARCODE`
   - Returns: Product name, console, prices

2. **Barcode Lookup** (general products)
   - API: `https://api.barcodelookup.com/v3/products?barcode=X&key=KEY`
   - Returns: Product details, images, category

3. **UPCitemDB** (alternative service)
   - API: `https://api.upcitemdb.com/prod/trial/lookup?upc=X`
   - Returns: Product info, images

### 4. First successful match is returned

If all providers fail or return no results:
```json
{
  "error": "Product not found in any database",
  "details": "pricecharting: Product not found; barcode_lookup: API error; upc_lookup: not configured",
  "providers_tried": ["pricecharting", "barcode_lookup"]
}
```

## Current API Key Status

According to the database, you have:
- ✅ **PriceCharting API Key**: Active
- ✅ **Barcode Lookup API Key**: Active
- ❌ **UPCitemDB API Key**: Not configured

This means the system will try PriceCharting first, then Barcode Lookup.

## What to Check

### 1. Is the barcode valid?
Test with a known video game barcode:
- Super Mario Odyssey: `045496590741`
- The Legend of Zelda BOTW: `045496590420`
- Pokemon Scarlet: `045496478056`

### 2. Check the detailed error logs
With the new logging, you'll see exactly which providers were tried and what they returned.

### 3. Verify API Keys Work
Go to Settings and click "Test" next to each API key:
- PriceCharting should return success
- Barcode Lookup should return success
- If they fail, check:
  - Is the API key correct?
  - Is your account active?
  - Have you hit rate limits?

## Expected Console Output

### Success Case:
```
Looking up barcode: 045496590741
Full response - data: {
  barcode: "045496590741",
  title: "Super Mario Odyssey",
  brand: "Nintendo Switch",
  ...
}
Full response - error: null
UPC lookup success: {...}
```

### Product Not Found:
```
Looking up barcode: 013388933044
Full response - data: {
  error: "Product not found in any database",
  details: "pricecharting: no product found; barcode_lookup: no product found",
  providers_tried: ["pricecharting", "barcode_lookup"]
}
Full response - error: { message: "Edge Function returned non-2xx status code", ... }
Error from response data: Product not found in any database
Final error message: Product not found in any database
UPC lookup exception: Error: Product not found for barcode 013388933044
```

### API Key Issue:
```
Looking up barcode: 045496590741
Full response - data: {
  error: "UPC lookup API key not configured. Please add a PriceCharting, Barcode Lookup, or UPCitemDB API key in Settings."
}
Full response - error: { ... }
Error from response data: UPC lookup API key not configured...
```

## Next Steps

1. **Clear Browser Cache & Reload**
   - The improvements to error logging are now in place
   - Refresh the page to get the updated code

2. **Try Scanning Again**
   - Scan barcode `013388933044`
   - Open browser DevTools (F12) → Console tab
   - Look at the detailed error logs

3. **Share the Console Output**
   - Take a screenshot or copy the console logs
   - The detailed output will show exactly what's happening

4. **Test with Known Barcodes**
   - Try scanning a known video game barcode
   - Compare the console output between working and failing barcodes

## Likely Root Cause

Based on the error pattern, the most likely cause is:

**The barcode `013388933044` doesn't exist in any of the lookup databases.**

This could mean:
- It's not a video game barcode
- It's a regional variant not in the databases
- It's a custom/promotional item
- The barcode is incorrect or damaged

## Solution

If a barcode isn't found:
1. **Add item manually** using the "Add Item" button
2. **Verify barcode** is correct by checking the product
3. **Try alternative barcode** if item has multiple (UPC vs EAN)
4. **Contact API providers** if it should be in their database

## Support Links

- PriceCharting API: https://www.pricecharting.com/api-documentation
- Barcode Lookup API: https://www.barcodelookup.com/api
- UPCitemDB API: https://www.upcitemdb.com/wp/api/
