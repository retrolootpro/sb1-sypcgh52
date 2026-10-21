import { z } from 'zod';

const resultSchema = z.object({
  formatted: z.string().max(500), country_code: z.string(),
  housenumber: z.string().max(30).optional(), street: z.string().max(120).optional(),
  city: z.string().max(100).optional(), state_code: z.string().optional(), postcode: z.string().optional(),
});
export const addressSearchResponseSchema = z.object({ results: z.array(resultSchema).max(20) });
export type AddressSuggestion = {
  label: string; line1: string; city: string; state: string; postal_code: string; country: 'US';
};

export function addressSuggestions(input: unknown): AddressSuggestion[] {
  const { results } = addressSearchResponseSchema.parse(input);
  return results.flatMap(result => {
    const state = result.state_code?.toUpperCase().replace(/^US-/, '');
    if (result.country_code.toLowerCase() !== 'us' || !result.housenumber || !result.street || !result.city
      || !state || !/^[A-Z]{2}$/.test(state) || !result.postcode || !/^\d{5}(-\d{4})?$/.test(result.postcode)) return [];
    const line1 = `${result.housenumber} ${result.street}`;
    if (line1.length > 150) return [];
    return [{ label: result.formatted, line1, city: result.city, state, postal_code: result.postcode, country: 'US' as const }];
  }).filter((result, index, all) => all.findIndex(other => other.label === result.label) === index).slice(0, 5);
}
