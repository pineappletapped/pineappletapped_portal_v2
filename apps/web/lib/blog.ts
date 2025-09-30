function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function buildExcerpt(excerpt: unknown, content: unknown): string {
  const source = cleanString(excerpt) || stripHtml(cleanString(content) || '');
  if (source.length <= 220) {
    return source;
  }
  return `${source.slice(0, 217).trimEnd()}...`;
}

type FirestoreValue =
  | { stringValue: string }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

function decodeValue(value: FirestoreValue | undefined): any {
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map((item) => decodeValue(item));
  }
  if ('mapValue' in value) {
    const entries = value.mapValue.fields || {};
    return Object.fromEntries(
      Object.entries(entries).map(([key, val]) => [key, decodeValue(val)])
    );
  }
  return null;
}

function decodeDocument(document: any) {
  const id = document?.name?.split('/')?.pop() || '';
  const fields: Record<string, FirestoreValue> = document?.fields || {};
  const decoded = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)])
  );
  return { id, ...decoded };
}

function ensureStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : String(item ?? '')))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

export interface BlogCategory {
  id: string;
  name: string;
  slug: string;
}

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  heroImageUrl?: string;
  imageUrl?: string;
  videoUrl?: string;
  categories: string[];
  tags: string[];
  publishAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isVisible: boolean;
}

const samplePosts: BlogPost[] = [
  {
    id: 'welcome',
    slug: 'welcome',
    title: 'Welcome to the Pineapple Portal',
    excerpt: 'A new way to manage your video projects, services and bookings.',
    content:
      '<p>The Pineapple Portal brings all of your video production needs into one simple dashboard. Explore services, track projects and collaborate with our team in real time.</p>',
    heroImageUrl: 'https://placehold.co/600x400',
    imageUrl: 'https://placehold.co/600x400',
    videoUrl: undefined,
    categories: [],
    tags: ['welcome'],
    publishAt: '2024-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    isVisible: true,
  },
  {
    id: 'livestream-tips',
    slug: 'livestream-tips',
    title: '5 Tips for a Standout Livestream',
    excerpt: 'Make your next livestream engaging and glitch-free with these simple tips.',
    content:
      '<p>Preparation is everything. From testing your connection to planning interactive moments, we break down the essentials for a successful broadcast.</p>',
    heroImageUrl: 'https://placehold.co/600x400',
    imageUrl: 'https://placehold.co/600x400',
    videoUrl: undefined,
    categories: [],
    tags: ['livestream'],
    publishAt: '2024-02-15T00:00:00.000Z',
    createdAt: '2024-02-15T00:00:00.000Z',
    updatedAt: '2024-02-15T00:00:00.000Z',
    isVisible: true,
  },
];

const sampleCategories: BlogCategory[] = [
  { id: 'news', name: 'News', slug: 'news' },
  { id: 'tips', name: 'Tips', slug: 'tips' },
];

function normalisePost(raw: any): BlogPost {
  const tags = ensureStringArray(raw.tags);
  const categories = ensureStringArray(raw.categories);
  const heroImageUrl = cleanString(raw.heroImageUrl) || cleanString(raw.imageUrl);
  const imageUrl = heroImageUrl || cleanString(raw.imageUrl);
  const publishAtIso = toIsoString(raw.publishAt);
  const createdAtIso = toIsoString(raw.createdAt);
  const updatedAtIso = toIsoString(raw.updatedAt);
  const derivedVisible =
    typeof raw.isVisible === 'boolean'
      ? raw.isVisible
      : raw.hidden === undefined
      ? false
      : !raw.hidden;

  return {
    id: raw.id,
    slug: cleanString(raw.slug) || raw.id,
    title: cleanString(raw.title) || cleanString(raw.slug) || raw.id,
    excerpt: buildExcerpt(raw.excerpt, raw.content),
    content: cleanString(raw.content) || '',
    heroImageUrl: heroImageUrl || undefined,
    imageUrl: imageUrl || undefined,
    videoUrl: cleanString(raw.videoUrl) || cleanString(raw.videoEmbedUrl),
    categories,
    tags,
    publishAt: publishAtIso,
    createdAt: createdAtIso,
    updatedAt: updatedAtIso,
    isVisible: Boolean(derivedVisible),
  };
}

function isPublished(post: BlogPost, now: Date): boolean {
  if (!post.isVisible) return false;
  const publishDateString = post.publishAt || post.createdAt;
  if (!publishDateString) {
    return true;
  }
  const publishDate = new Date(publishDateString);
  if (Number.isNaN(publishDate.getTime())) {
    return true;
  }
  return publishDate.getTime() <= now.getTime();
}

async function fetchServerPosts(): Promise<BlogPost[]> {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    'pineapple-tapped---portal';
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    process.env.FIREBASE_ADMIN_API_KEY ||
    'AIzaSyCNf650E4LdnQ7Tk4fBf2DOxKJxGhU8jgE';
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'blogPosts' }],
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    throw new Error(`Failed to load blog posts: ${response.status}`);
  }

  const json = await response.json();
  const now = new Date();
  return json
    .filter((item: any) => item.document)
    .map((item: any) => decodeDocument(item.document))
    .map((raw: any) => normalisePost(raw))
    .filter((post: BlogPost) => isPublished(post, now))
    .sort((a: BlogPost, b: BlogPost) => {
      const aDate = a.publishAt || a.createdAt;
      const bDate = b.publishAt || b.createdAt;
      const aTime = aDate ? new Date(aDate).getTime() : 0;
      const bTime = bDate ? new Date(bDate).getTime() : 0;
      return bTime - aTime;
    });
}

async function fetchServerCategories(): Promise<BlogCategory[]> {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    'pineapple-tapped---portal';
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    process.env.FIREBASE_ADMIN_API_KEY ||
    'AIzaSyCNf650E4LdnQ7Tk4fBf2DOxKJxGhU8jgE';
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/blogCategories?key=${apiKey}`;
  const response = await fetch(url, { next: { revalidate: 300 } });
  if (!response.ok) {
    throw new Error(`Failed to load blog categories: ${response.status}`);
  }
  const json = await response.json();
  return (json.documents || [])
    .map((doc: any) => decodeDocument(doc))
    .map((raw: any) => ({
      id: raw.id,
      name: cleanString(raw.name) || raw.id,
      slug: cleanString(raw.slug) || raw.id,
    }))
    .sort((a: BlogCategory, b: BlogCategory) => a.name.localeCompare(b.name));
}

async function fetchServerPost(identifier: string): Promise<BlogPost | null> {
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_ADMIN_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    'pineapple-tapped---portal';
  const apiKey =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    process.env.FIREBASE_ADMIN_API_KEY ||
    'AIzaSyCNf650E4LdnQ7Tk4fBf2DOxKJxGhU8jgE';
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`;

  const slugQuery = await fetch(`${base}/documents:runQuery?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'blogPosts' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'slug' },
            op: 'EQUAL',
            value: { stringValue: identifier },
          },
        },
        limit: 1,
      },
    }),
    next: { revalidate: 300 },
  });

  if (slugQuery.ok) {
    const slugJson = await slugQuery.json();
    const match = slugJson.find((item: any) => item.document);
    if (match?.document) {
      const post = normalisePost(decodeDocument(match.document));
      const now = new Date();
      if (isPublished(post, now)) {
        return post;
      }
      return null;
    }
  }

  const docResponse = await fetch(`${base}/documents/blogPosts/${identifier}?key=${apiKey}`, {
    next: { revalidate: 300 },
  });

  if (!docResponse.ok) {
    return null;
  }

  const docJson = await docResponse.json();
  const post = normalisePost(decodeDocument(docJson));
  const now = new Date();
  return isPublished(post, now) ? post : null;
}

export async function getPosts(): Promise<BlogPost[]> {
  if (typeof window !== 'undefined') {
    return samplePosts;
  }

  try {
    return await fetchServerPosts();
  } catch (error) {
    console.error('Falling back to sample blog posts', error);
    return samplePosts;
  }
}

export async function getPost(identifier: string): Promise<BlogPost | null> {
  if (typeof window !== 'undefined') {
    return samplePosts.find((post) => post.slug === identifier || post.id === identifier) || null;
  }

  try {
    const post = await fetchServerPost(identifier);
    if (post) {
      return post;
    }
  } catch (error) {
    console.error('Failed to fetch blog post', error);
  }
  return (
    samplePosts.find((post) => post.slug === identifier || post.id === identifier) || null
  );
}

export async function getBlogCategories(): Promise<BlogCategory[]> {
  if (typeof window !== 'undefined') {
    return sampleCategories;
  }

  try {
    return await fetchServerCategories();
  } catch (error) {
    console.error('Falling back to sample blog categories', error);
    return sampleCategories;
  }
}
