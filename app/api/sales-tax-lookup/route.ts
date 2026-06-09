import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerAccountContext } from '@/lib/server-account';

export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function cleanZip(value: unknown) {
  return String(value || '').trim().match(/^\d{5}(?:-\d{4})?$/)?.[0] || '';
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') ?? '';
    if (!authHeader) return json({ success: false, message: 'Missing authorization' }, 401);

    const body = await req.json().catch(() => ({}));
    const zip = cleanZip(body.zip);
    if (!zip) return json({ success: false, message: 'Enter a valid 5-digit ZIP code.' }, 400);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return json({ success: false, message: 'Auth failed' }, 401);
    const { accountId } = await getServerAccountContext(supabase, user);

    const { data: keyRow } = await supabase
      .from('user_api_keys')
      .select('api_key')
      .eq('user_id', accountId)
      .eq('provider', 'taxjar')
      .eq('status', 'active')
      .maybeSingle();

    if (!keyRow?.api_key) {
      return json({
        success: false,
        message: 'TaxJar API key is required for ZIP sales tax lookup. Add it in Settings > API Keys.',
      }, 200);
    }

    const url = new URL(`https://api.taxjar.com/v2/rates/${encodeURIComponent(zip)}`);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${keyRow.api_key}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.rate) {
      return json({
        success: false,
        message: data?.detail || data?.error || `Tax lookup failed with status ${response.status}`,
      }, 200);
    }

    const rate = data.rate;
    const combinedRate = Number(rate.combined_rate || 0);
    return json({
      success: true,
      zip,
      provider: 'TaxJar',
      rate: combinedRate,
      ratePercent: Number((combinedRate * 100).toFixed(4)),
      source: `TaxJar ZIP ${zip}`,
      jurisdictions: {
        state: rate.state || '',
        county: rate.county || '',
        city: rate.city || '',
        stateRate: Number(rate.state_rate || 0),
        countyRate: Number(rate.county_rate || 0),
        cityRate: Number(rate.city_rate || 0),
        districtRate: Number(rate.combined_district_rate || 0),
      },
    });
  } catch (error) {
    return json({
      success: false,
      message: error instanceof Error ? error.message : 'Sales tax lookup failed',
    }, 200);
  }
}
