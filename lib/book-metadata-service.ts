export type BookIdentifierKind = 'isbn10' | 'isbn13' | 'retail_upc' | 'invalid';

export type NormalizedBookIdentifier = {
  raw: string;
  cleaned: string;
  kind: BookIdentifierKind;
  isbn10: string;
  isbn13: string;
  queryIsbn: string;
  valid: boolean;
  reason?: string;
};

export type BookMetadataSource = 'google_books' | 'open_library';

export type BookMetadataResult = {
  title: string;
  subtitle: string;
  authors: string[];
  publisher: string;
  publishedDate: string;
  publishedYear: string;
  description: string;
  pageCount: number | null;
  categories: string[];
  language: string;
  isbn10: string;
  isbn13: string;
  coverImageUrl: string;
  thumbnailUrl: string;
  retailPrice: number | null;
  retailPriceCurrency: string;
  retailPriceSource: string;
  platform: string;
  category: string;
  brand: string;
  imageUrl: string;
  source: BookMetadataSource;
  sourcesTried: BookMetadataSource[];
};

function cleanText(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, '');
}

function sanitizeInput(value: string) {
  return cleanText(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^isbn(?:-1[03])?:?/i, '')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
}

export function isValidIsbn10(value: string) {
  const isbn = sanitizeInput(value);
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  const total = isbn.split('').reduce((sum, char, index) => {
    const digit = char === 'X' ? 10 : Number(char);
    return sum + digit * (10 - index);
  }, 0);
  return total % 11 === 0;
}

export function isValidIsbn13(value: string) {
  const isbn = sanitizeInput(value);
  if (!/^\d{13}$/.test(isbn)) return false;
  const total = isbn.split('').reduce((sum, char, index) => {
    const digit = Number(char);
    return sum + digit * (index % 2 === 0 ? 1 : 3);
  }, 0);
  return total % 10 === 0;
}

export function isbn10ToIsbn13(value: string) {
  const isbn10 = sanitizeInput(value);
  if (!isValidIsbn10(isbn10)) return '';
  const base = `978${isbn10.slice(0, 9)}`;
  const total = base.split('').reduce((sum, char, index) => sum + Number(char) * (index % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (total % 10)) % 10;
  return `${base}${check}`;
}

export function normalizeBookIdentifier(input: string): NormalizedBookIdentifier {
  const raw = cleanText(input);
  const cleaned = sanitizeInput(raw);
  const numeric = digitsOnly(cleaned);

  if (!cleaned) {
    return { raw, cleaned, kind: 'invalid', isbn10: '', isbn13: '', queryIsbn: '', valid: false, reason: 'Barcode or ISBN is required.' };
  }

  if (cleaned.length >= 13 && /^(978|979)/.test(cleaned)) {
    const isbn13 = cleaned.slice(0, 13);
    if (!isValidIsbn13(isbn13)) {
      return { raw, cleaned, kind: 'isbn13', isbn10: '', isbn13, queryIsbn: isbn13, valid: false, reason: 'Invalid ISBN-13 checksum.' };
    }
    return { raw, cleaned, kind: 'isbn13', isbn10: '', isbn13, queryIsbn: isbn13, valid: true };
  }

  if (cleaned.length === 10) {
    if (!isValidIsbn10(cleaned)) {
      return { raw, cleaned, kind: 'isbn10', isbn10: cleaned, isbn13: '', queryIsbn: cleaned, valid: false, reason: 'Invalid ISBN-10 checksum.' };
    }
    const isbn13 = isbn10ToIsbn13(cleaned);
    return { raw, cleaned, kind: 'isbn10', isbn10: cleaned, isbn13, queryIsbn: isbn13 || cleaned, valid: true };
  }

  if (numeric.length >= 8 && numeric.length <= 14) {
    return {
      raw,
      cleaned: numeric,
      kind: 'retail_upc',
      isbn10: '',
      isbn13: '',
      queryIsbn: '',
      valid: false,
      reason: 'This looks like a retail UPC, not a valid ISBN. Enter the book title manually and keep the barcode on the item.',
    };
  }

  return { raw, cleaned, kind: 'invalid', isbn10: '', isbn13: '', queryIsbn: '', valid: false, reason: 'Barcode is not a valid ISBN-10, ISBN-13, or supported Bookland EAN.' };
}

function cleanImageUrl(url: string) {
  if (!url) return '';
  return url.replace(/^http:\/\//i, 'https://');
}

function publishedYear(date: string) {
  return date.match(/\d{4}/)?.[0] || '';
}

function bookPlatform(categories: string[]) {
  const text = categories.join(' ');
  return /manga|comic|graphic novel/i.test(text) ? 'Manga' : 'Book';
}

function bookCategory(platform: string, categories: string[]) {
  const categoryText = categories.filter(Boolean).join(', ');
  if (categoryText) return `${platform === 'Manga' ? 'Manga' : 'Books'}, ${categoryText}`;
  return 'Books & Media';
}

function identifiersFromGoogle(volume: any) {
  const ids = Array.isArray(volume?.industryIdentifiers) ? volume.industryIdentifiers : [];
  const isbn10 = ids.find((id: any) => id?.type === 'ISBN_10')?.identifier || '';
  const isbn13 = ids.find((id: any) => id?.type === 'ISBN_13')?.identifier || '';
  return { isbn10, isbn13 };
}

function googleRetailPrice(saleInfo: any) {
  const price = saleInfo?.listPrice || saleInfo?.retailPrice || null;
  const amount = Number(price?.amount);
  return {
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: cleanText(price?.currencyCode || ''),
  };
}

function fromGoogleItem(item: any, fallback: NormalizedBookIdentifier): BookMetadataResult | null {
  const volume = item?.volumeInfo;
  const saleInfo = item?.saleInfo;
  const title = cleanText(volume?.title);
  if (!title) return null;
  const subtitle = cleanText(volume?.subtitle);
  const authors = Array.isArray(volume?.authors) ? volume.authors.map(cleanText).filter(Boolean) : [];
  const categories = Array.isArray(volume?.categories) ? volume.categories.map(cleanText).filter(Boolean) : [];
  const imageLinks = volume?.imageLinks || {};
  const thumbnailUrl = cleanImageUrl(imageLinks.thumbnail || imageLinks.smallThumbnail || '');
  const imageUrl = cleanImageUrl(imageLinks.extraLarge || imageLinks.large || imageLinks.medium || thumbnailUrl);
  const ids = identifiersFromGoogle(volume);
  const platform = bookPlatform(categories);
  const retail = googleRetailPrice(saleInfo);

  return {
    title,
    subtitle,
    authors,
    publisher: cleanText(volume?.publisher),
    publishedDate: cleanText(volume?.publishedDate),
    publishedYear: publishedYear(cleanText(volume?.publishedDate)),
    description: cleanText(volume?.description),
    pageCount: Number.isFinite(Number(volume?.pageCount)) ? Number(volume.pageCount) : null,
    categories,
    language: cleanText(volume?.language),
    isbn10: cleanText(ids.isbn10 || fallback.isbn10),
    isbn13: cleanText(ids.isbn13 || fallback.isbn13),
    coverImageUrl: imageUrl,
    thumbnailUrl,
    retailPrice: retail.amount,
    retailPriceCurrency: retail.currency,
    retailPriceSource: retail.amount ? 'google_books_sale_info' : '',
    platform,
    category: bookCategory(platform, categories),
    brand: cleanText(volume?.publisher || authors.join(', ') || 'Books'),
    imageUrl,
    source: 'google_books',
    sourcesTried: ['google_books'],
  };
}

async function lookupGoogleBooks(identifier: NormalizedBookIdentifier): Promise<BookMetadataResult | null> {
  const queries = Array.from(new Set([identifier.queryIsbn, identifier.isbn13, identifier.isbn10].filter(Boolean)));
  for (const isbn of queries) {
    const response = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`isbn:${isbn}`)}&maxResults=3`,
      { cache: 'no-store' }
    );
    if (!response.ok) throw new Error(`Google Books request failed (${response.status})`);
    const data = await response.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    for (const item of items) {
      const result = fromGoogleItem(item, identifier);
      if (result?.title) return result;
    }
  }
  return null;
}

function fromOpenLibraryRecord(data: any, identifier: NormalizedBookIdentifier, searchDoc?: any): BookMetadataResult | null {
  const title = cleanText(data?.title || searchDoc?.title);
  if (!title) return null;
  const categories = [
    ...(Array.isArray(data?.subjects) ? data.subjects.slice(0, 5) : []),
    ...(Array.isArray(searchDoc?.subject) ? searchDoc.subject.slice(0, 5) : []),
  ].map(cleanText).filter(Boolean);
  const publishers = Array.isArray(data?.publishers) ? data.publishers : Array.isArray(searchDoc?.publisher) ? searchDoc.publisher : [];
  const authors = Array.isArray(searchDoc?.author_name) ? searchDoc.author_name.map(cleanText).filter(Boolean) : [];
  const coverId = data?.covers?.[0] || searchDoc?.cover_i;
  const imageUrl = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '';
  const thumbnailUrl = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : '';
  const publishedDateValue = cleanText(data?.publish_date || searchDoc?.first_publish_year || '');
  const platform = bookPlatform(categories);

  return {
    title,
    subtitle: '',
    authors,
    publisher: cleanText(publishers[0]),
    publishedDate: publishedDateValue,
    publishedYear: publishedYear(publishedDateValue),
    description: typeof data?.description === 'string' ? cleanText(data.description) : cleanText(data?.description?.value),
    pageCount: Number.isFinite(Number(data?.number_of_pages)) ? Number(data.number_of_pages) : null,
    categories,
    language: Array.isArray(searchDoc?.language) ? cleanText(searchDoc.language[0]) : '',
    isbn10: cleanText(data?.isbn_10?.[0] || searchDoc?.isbn?.find((id: string) => /^\d{9}[\dX]$/i.test(id)) || identifier.isbn10),
    isbn13: cleanText(data?.isbn_13?.[0] || searchDoc?.isbn?.find((id: string) => /^(978|979)\d{10}$/.test(id)) || identifier.isbn13),
    coverImageUrl: imageUrl,
    thumbnailUrl,
    retailPrice: null,
    retailPriceCurrency: '',
    retailPriceSource: '',
    platform,
    category: bookCategory(platform, categories),
    brand: cleanText(publishers[0] || authors.join(', ') || 'Books'),
    imageUrl,
    source: 'open_library',
    sourcesTried: ['open_library'],
  };
}

async function lookupOpenLibrary(identifier: NormalizedBookIdentifier): Promise<BookMetadataResult | null> {
  const isbn = identifier.queryIsbn || identifier.isbn13 || identifier.isbn10;
  if (!isbn) return null;

  let record: any = null;
  const recordResponse = await fetch(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`, { cache: 'no-store' });
  if (recordResponse.ok) {
    record = await recordResponse.json();
  } else if (recordResponse.status >= 500) {
    throw new Error(`Open Library request failed (${recordResponse.status})`);
  }

  let searchDoc: any = null;
  const searchResponse = await fetch(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&limit=1`, { cache: 'no-store' });
  if (searchResponse.ok) {
    const search = await searchResponse.json();
    searchDoc = Array.isArray(search?.docs) ? search.docs[0] : null;
  } else if (searchResponse.status >= 500) {
    throw new Error(`Open Library search failed (${searchResponse.status})`);
  }

  return fromOpenLibraryRecord(record, identifier, searchDoc);
}

function mergeBookMetadata(primary: BookMetadataResult, fallback: BookMetadataResult | null) {
  if (!fallback) return primary;
  return {
    ...primary,
    subtitle: primary.subtitle || fallback.subtitle,
    authors: primary.authors.length ? primary.authors : fallback.authors,
    publisher: primary.publisher || fallback.publisher,
    publishedDate: primary.publishedDate || fallback.publishedDate,
    publishedYear: primary.publishedYear || fallback.publishedYear,
    description: primary.description || fallback.description,
    pageCount: primary.pageCount ?? fallback.pageCount,
    categories: primary.categories.length ? primary.categories : fallback.categories,
    language: primary.language || fallback.language,
    isbn10: primary.isbn10 || fallback.isbn10,
    isbn13: primary.isbn13 || fallback.isbn13,
    coverImageUrl: primary.coverImageUrl || fallback.coverImageUrl,
    thumbnailUrl: primary.thumbnailUrl || fallback.thumbnailUrl,
    retailPrice: primary.retailPrice ?? fallback.retailPrice,
    retailPriceCurrency: primary.retailPriceCurrency || fallback.retailPriceCurrency,
    retailPriceSource: primary.retailPriceSource || fallback.retailPriceSource,
    imageUrl: primary.imageUrl || fallback.imageUrl,
    sourcesTried: Array.from(new Set([...primary.sourcesTried, ...fallback.sourcesTried])),
  };
}

export async function lookupBookMetadataByBarcode(barcode: string): Promise<BookMetadataResult | null> {
  const identifier = normalizeBookIdentifier(barcode);
  if (!identifier.valid) return null;

  const sourcesTried: BookMetadataSource[] = [];
  let google: BookMetadataResult | null = null;
  let openLibrary: BookMetadataResult | null = null;
  let lastError: Error | null = null;

  try {
    sourcesTried.push('google_books');
    google = await lookupGoogleBooks(identifier);
  } catch (error) {
    lastError = error instanceof Error ? error : new Error('Google Books lookup failed');
  }

  try {
    sourcesTried.push('open_library');
    openLibrary = await lookupOpenLibrary(identifier);
  } catch (error) {
    lastError = error instanceof Error ? error : new Error('Open Library lookup failed');
  }

  const result = google ? mergeBookMetadata(google, openLibrary) : openLibrary;
  if (result) {
    return {
      ...result,
      isbn10: result.isbn10 || identifier.isbn10,
      isbn13: result.isbn13 || identifier.isbn13,
      sourcesTried: Array.from(new Set(sourcesTried)),
    };
  }

  if (lastError) throw lastError;
  return null;
}
