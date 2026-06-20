export type BookMetadataSource =
  | 'google_books'
  | 'google_books_search'
  | 'open_library'
  | 'open_library_search'
  | 'barcode_lookup'
  | 'upc_item_db';

export type BookMetadataResult = {
  title: string;
  platform: string;
  category: string;
  brand: string;
  description: string;
  imageUrl: string;
  thumbnailUrl: string;
  source: BookMetadataSource;
};

type BarcodeLookupProduct = {
  title?: string;
  product_name?: string;
  brand?: string;
  manufacturer?: string;
  category?: string;
  description?: string;
  images?: string[];
};

type UpcItemDbProduct = {
  title?: string;
  brand?: string;
  category?: string;
  description?: string;
  images?: string[];
};

function cleanImage(url: string) {
  if (!url) return '';
  return url.replace(/^http:\/\//i, 'https://');
}

function cleanText(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function barcodeCandidates(barcode: string) {
  const digitsOnly = barcode.replace(/\D/g, '');
  const candidates = [barcode, digitsOnly];
  if (/^(978|979)\d{10}\d{2,5}$/.test(digitsOnly)) candidates.push(digitsOnly.slice(0, 13));
  return Array.from(new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean)));
}

function isbnCandidates(barcode: string) {
  return barcodeCandidates(barcode).filter((candidate) => /^(978|979)\d{10}$/.test(candidate));
}

function upcCandidates(barcode: string) {
  const digitsOnly = barcode.replace(/\D/g, '');
  if (/^(978|979)\d{10}\d{2,5}$/.test(digitsOnly)) return [];
  return barcodeCandidates(barcode).filter((candidate) => /^\d{8,14}$/.test(candidate));
}

function bookPlatform(title: string, category: string) {
  return /manga|comic|graphic novel/i.test(`${title} ${category}`) ? 'Manga' : 'Book';
}

function bookCategory(platform: string, category?: string) {
  const cleanCategory = cleanText(category);
  const base = platform === 'Manga' ? 'Manga' : 'Books';
  if (!cleanCategory) return 'Books & Media';
  return cleanCategory.toLowerCase().includes(base.toLowerCase())
    ? cleanCategory
    : `${base}, ${cleanCategory}`;
}

function looksLikeBook(product: BarcodeLookupProduct | UpcItemDbProduct) {
  const text = [
    product.title,
    'product_name' in product ? product.product_name : '',
    product.brand,
    'manufacturer' in product ? product.manufacturer : '',
    product.category,
    product.description,
  ].join(' ');
  return /book|books|fiction|paperback|hardcover|scholastic|publisher|reading|novel|manga|comic|graphic novel|children/i.test(text);
}

function isLowConfidenceBookTitle(title: string) {
  return /^(untitled|unknown|not specified|n\/a|na)\b/i.test(title.trim());
}

function fromBookFields(input: {
  title: unknown;
  category?: unknown;
  brand?: unknown;
  description?: unknown;
  imageUrl?: unknown;
  thumbnailUrl?: unknown;
  source: BookMetadataSource;
}): BookMetadataResult | null {
  const title = cleanText(input.title);
  if (!title) return null;
  if (isLowConfidenceBookTitle(title)) return null;
  const category = cleanText(input.category);
  const platform = bookPlatform(title, category);
  const imageUrl = cleanImage(cleanText(input.imageUrl));
  const thumbnailUrl = cleanImage(cleanText(input.thumbnailUrl) || imageUrl);

  return {
    title,
    platform,
    category: bookCategory(platform, category),
    brand: cleanText(input.brand) || 'Books',
    description: cleanText(input.description),
    imageUrl,
    thumbnailUrl,
    source: input.source,
  };
}

async function lookupGoogleBooks(query: string, source: 'google_books' | 'google_books_search'): Promise<BookMetadataResult | null> {
  const response = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5`,
    { cache: 'no-store' }
  );
  if (!response.ok) return null;

  const data = await response.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  for (const item of items) {
    const volume = item?.volumeInfo;
    if (!volume?.title) continue;
    const categories = Array.isArray(volume.categories) ? volume.categories : [];
    const authors = Array.isArray(volume.authors) ? volume.authors : [];
    const imageLinks = volume.imageLinks || {};
    const thumbnailUrl = cleanImage(imageLinks.thumbnail || imageLinks.smallThumbnail || '');
    const result = fromBookFields({
      title: volume.title,
      category: categories.join(', '),
      brand: volume.publisher || authors.join(', '),
      description: volume.description,
      imageUrl: imageLinks.extraLarge || imageLinks.large || imageLinks.medium || thumbnailUrl,
      thumbnailUrl,
      source,
    });
    if (result) return result;
  }

  return null;
}

async function lookupOpenLibraryIsbn(isbn: string): Promise<BookMetadataResult | null> {
  const response = await fetch(
    `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`,
    { cache: 'no-store' }
  );
  if (!response.ok) return null;

  const data = await response.json();
  if (!data?.title) return null;
  const publishers = Array.isArray(data.publishers) ? data.publishers : [];
  const subjects = Array.isArray(data.subjects) ? data.subjects.slice(0, 5) : [];
  const coverId = data.covers?.[0];

  return fromBookFields({
    title: data.title,
    category: subjects.join(', '),
    brand: publishers[0],
    description: typeof data.description === 'string' ? data.description : data.description?.value,
    imageUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '',
    thumbnailUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : '',
    source: 'open_library',
  });
}

async function lookupOpenLibrarySearch(query: string): Promise<BookMetadataResult | null> {
  const response = await fetch(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=5`,
    { cache: 'no-store' }
  );
  if (!response.ok) return null;

  const data = await response.json();
  const docs = Array.isArray(data?.docs) ? data.docs : [];
  for (const doc of docs) {
    if (!doc?.title) continue;
    const coverId = doc.cover_i;
    const subject = Array.isArray(doc.subject) ? doc.subject.slice(0, 5).join(', ') : '';
    const result = fromBookFields({
      title: doc.title,
      category: subject,
      brand: Array.isArray(doc.publisher) ? doc.publisher[0] : Array.isArray(doc.author_name) ? doc.author_name.join(', ') : '',
      description: '',
      imageUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '',
      thumbnailUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : '',
      source: 'open_library_search',
    });
    if (result) return result;
  }

  return null;
}

async function lookupBarcodeLookup(barcode: string, apiKey?: string): Promise<BookMetadataResult | null> {
  if (!apiKey) return null;
  const params = new URLSearchParams({ barcode, formatted: 'y', key: apiKey });
  const response = await fetch(`https://api.barcodelookup.com/v3/products?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) return null;
  const data = await response.json();
  const products = Array.isArray(data?.products) ? data.products as BarcodeLookupProduct[] : [];
  const product = products.find(looksLikeBook);
  if (!product) return null;

  return fromBookFields({
    title: product.title || product.product_name,
    category: product.category,
    brand: product.brand || product.manufacturer,
    description: product.description,
    imageUrl: Array.isArray(product.images) ? product.images[0] : '',
    thumbnailUrl: Array.isArray(product.images) ? product.images[0] : '',
    source: 'barcode_lookup',
  });
}

async function lookupUpcItemDb(barcode: string, apiKey?: string): Promise<BookMetadataResult | null> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const url = apiKey
    ? `https://api.upcitemdb.com/prod/v1/lookup?upc=${encodeURIComponent(barcode)}`
    : `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;
  if (apiKey) headers.user_key = apiKey;

  const response = await fetch(url, { headers, cache: 'no-store' });
  if (!response.ok) return null;
  const data = await response.json();
  const items = Array.isArray(data?.items) ? data.items as UpcItemDbProduct[] : [];
  const item = items.find(looksLikeBook);
  if (!item) return null;

  return fromBookFields({
    title: item.title,
    category: item.category,
    brand: item.brand,
    description: item.description,
    imageUrl: Array.isArray(item.images) ? item.images[0] : '',
    thumbnailUrl: Array.isArray(item.images) ? item.images[0] : '',
    source: 'upc_item_db',
  });
}

export async function lookupBookMetadataByBarcode(
  barcode: string,
  options: { barcodeLookupKey?: string; upcItemDbKey?: string } = {}
): Promise<BookMetadataResult | null> {
  const cleanBarcode = cleanText(barcode);
  if (!cleanBarcode) return null;

  for (const candidate of isbnCandidates(cleanBarcode)) {
    const match =
      (await lookupGoogleBooks(`isbn:${candidate}`, 'google_books')) ||
      (await lookupOpenLibraryIsbn(candidate));

    if (match) return match;
  }

  for (const candidate of upcCandidates(cleanBarcode)) {
    const match =
      (await lookupBarcodeLookup(candidate, options.barcodeLookupKey)) ||
      (await lookupUpcItemDb(candidate, options.upcItemDbKey));

    if (match) return match;
  }

  return null;
}
