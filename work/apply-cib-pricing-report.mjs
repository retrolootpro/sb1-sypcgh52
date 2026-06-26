import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

function readEnv(file) {
  const env = {};
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
  }
  return env;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [headers, ...data] = rows;
  return data
    .filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((key, idx) => [key, values[idx] ?? ''])));
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error('Usage: node work/apply-cib-pricing-report.mjs <audit-report.csv>');
  const env = readEnv(path.join(process.cwd(), '.env'));
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const rows = parseCsv(fs.readFileSync(reportPath, 'utf8')).filter((row) =>
    row.flag === 'selected_market_value_is_loose' || row.flag === 'price_refresh_needed'
  );

  const updated = [];
  for (const row of rows) {
    const update = {
      price_loose: num(row.pc_loose),
      price_cib: num(row.pc_cib),
      price_new: num(row.pc_new),
      price_graded: num(row.pc_graded),
      selected_market_value: num(row.pc_selected_market_value),
      pricing_status: 'found',
      pricing_source: 'PriceCharting',
      pricing_last_checked_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('inventory_items')
      .update(update)
      .eq('id', row.id);
    if (error) throw error;
    updated.push({
      id: row.id,
      product_name: row.product_name,
      console: row.console,
      old_market: num(row.saved_selected_market_value),
      new_market: update.selected_market_value,
      flag: row.flag,
    });
  }

  console.log(JSON.stringify({ updated: updated.length, rows: updated }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
