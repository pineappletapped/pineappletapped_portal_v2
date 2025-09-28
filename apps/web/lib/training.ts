import type { Timestamp } from 'firebase/firestore';

export type TrainingAudience = 'franchisees' | 'teamMembers' | 'clients';

export const TRAINING_AUDIENCE_OPTIONS: {
  key: TrainingAudience;
  label: string;
  description: string;
}[] = [
  {
    key: 'franchisees',
    label: 'Franchisees',
    description: 'Territory owners and franchise leads who require onboarding and operational guidance.',
  },
  {
    key: 'teamMembers',
    label: 'Team members',
    description: 'Contractors, editors, and HQ staff who need production process refreshers.',
  },
  {
    key: 'clients',
    label: 'Clients',
    description: 'End clients who access the portal to collaborate on projects and approvals.',
  },
];

export type TrainingVideoBlock = {
  id: string;
  type: 'video';
  title?: string;
  url: string;
  description?: string;
};

export type TrainingTextBlock = {
  id: string;
  type: 'text';
  title?: string;
  body: string;
};

export type TrainingImageBlock = {
  id: string;
  type: 'image';
  title?: string;
  url: string;
  caption?: string;
};

export type TrainingLinkBlock = {
  id: string;
  type: 'link';
  title: string;
  url: string;
  description?: string;
};

export type TrainingContentBlock =
  | TrainingVideoBlock
  | TrainingTextBlock
  | TrainingImageBlock
  | TrainingLinkBlock;

export type TrainingResource = {
  id: string;
  title: string;
  url: string;
  description?: string;
};

export type TimestampLike = Timestamp | Date | string | null | undefined;

export interface TrainingModuleRecord {
  id: string;
  title: string;
  summary: string;
  category?: string | null;
  keywords: string[];
  audiences: TrainingAudience[];
  heroImageUrl?: string | null;
  estimatedDuration?: string | null;
  content: TrainingContentBlock[];
  resources?: TrainingResource[];
  createdAt?: TimestampLike;
  updatedAt?: TimestampLike;
  publishedAt?: TimestampLike;
}

export type TrainingModuleDraft = Omit<
  TrainingModuleRecord,
  'id' | 'createdAt' | 'updatedAt' | 'publishedAt'
>;

const AUDIENCE_LABEL_LOOKUP: Record<TrainingAudience, string> = TRAINING_AUDIENCE_OPTIONS.reduce(
  (acc, option) => {
    acc[option.key] = option.label;
    return acc;
  },
  {} as Record<TrainingAudience, string>
);

const createRandomId = (prefix: string) => {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
      return `${prefix}-${globalThis.crypto.randomUUID()}`;
    }
  } catch (error) {
    // Ignore – will fallback to Math.random below.
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
};

export function getTrainingAudienceLabel(audience: TrainingAudience): string {
  return AUDIENCE_LABEL_LOOKUP[audience] ?? audience;
}

export function formatTrainingAudienceList(audiences: TrainingAudience[]): string {
  if (!Array.isArray(audiences) || audiences.length === 0) {
    return 'No audience';
  }
  return audiences.map((audience) => getTrainingAudienceLabel(audience)).join(', ');
}

export function timestampToDate(value: TimestampLike): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object' && typeof (value as Timestamp)?.toDate === 'function') {
    try {
      return (value as Timestamp).toDate();
    } catch (error) {
      console.warn('Failed to convert timestamp to date', error);
      return null;
    }
  }
  if (typeof value === 'object' && typeof (value as Timestamp)?.toMillis === 'function') {
    try {
      return new Date((value as Timestamp).toMillis());
    } catch (error) {
      console.warn('Failed to convert timestamp millis to date', error);
      return null;
    }
  }
  return null;
}

export function isTrainingModuleNew(
  module: Pick<TrainingModuleRecord, 'publishedAt' | 'createdAt'>,
  referenceDate: Date = new Date(),
  thresholdDays = 14
): boolean {
  const published = timestampToDate(module.publishedAt ?? module.createdAt);
  if (!published) {
    return false;
  }
  const msPerDay = 1000 * 60 * 60 * 24;
  const diffMs = referenceDate.getTime() - published.getTime();
  return diffMs <= thresholdDays * msPerDay;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isAudienceArray = (value: unknown): value is TrainingAudience[] =>
  Array.isArray(value) && value.every((item) => TRAINING_AUDIENCE_OPTIONS.some((option) => option.key === item));

const sanitizeContentBlock = (block: any): TrainingContentBlock | null => {
  if (!block || typeof block !== 'object') {
    return null;
  }
  const id =
    typeof block.id === 'string' && block.id ? block.id : createRandomId('block');
  switch (block.type) {
    case 'text': {
      const body = typeof block.body === 'string' ? block.body : '';
      const title = typeof block.title === 'string' ? block.title : undefined;
      if (!body.trim() && !title) {
        return null;
      }
      return { id, type: 'text', body, title };
    }
    case 'video': {
      const url = typeof block.url === 'string' ? block.url : '';
      if (!url.trim()) {
        return null;
      }
      const title = typeof block.title === 'string' ? block.title : undefined;
      const description = typeof block.description === 'string' ? block.description : undefined;
      return { id, type: 'video', url, title, description };
    }
    case 'image': {
      const url = typeof block.url === 'string' ? block.url : '';
      if (!url.trim()) {
        return null;
      }
      const title = typeof block.title === 'string' ? block.title : undefined;
      const caption = typeof block.caption === 'string' ? block.caption : undefined;
      return { id, type: 'image', url, title, caption };
    }
    case 'link': {
      const url = typeof block.url === 'string' ? block.url : '';
      const title = typeof block.title === 'string' ? block.title : '';
      if (!url.trim() || !title.trim()) {
        return null;
      }
      const description = typeof block.description === 'string' ? block.description : undefined;
      return { id, type: 'link', url, title, description };
    }
    default:
      return null;
  }
};

export function normaliseTrainingModule(id: string, data: any): TrainingModuleRecord {
  const rawKeywords = isStringArray(data?.keywords)
    ? data.keywords
    : typeof data?.keywords === 'string'
      ? data.keywords.split(',')
      : [];
  const keywords = rawKeywords.map((keyword) => keyword.trim()).filter(Boolean);

  const rawAudiences = isAudienceArray(data?.audiences)
    ? (data.audiences as TrainingAudience[])
    : Array.isArray(data?.audiences)
      ? (data.audiences.filter((item: unknown) =>
          TRAINING_AUDIENCE_OPTIONS.some((option) => option.key === item)
        ) as TrainingAudience[])
      : [];
  const audiences = rawAudiences.length > 0 ? rawAudiences : ['clients'];

  const content: TrainingContentBlock[] = Array.isArray(data?.content)
    ? data.content
        .map((block: any, index: number) => {
          const result = sanitizeContentBlock(block);
          if (!result) {
            return null;
          }
          if (!result.id) {
            return { ...result, id: `block-${index}` } as TrainingContentBlock;
          }
          return result;
        })
        .filter((block): block is TrainingContentBlock => Boolean(block))
    : [];

  const resources: TrainingResource[] = Array.isArray(data?.resources)
    ? data.resources
        .map((resource: any, index: number) => {
          if (!resource || typeof resource !== 'object') {
            return null;
          }
          const title = typeof resource.title === 'string' ? resource.title.trim() : '';
          const url = typeof resource.url === 'string' ? resource.url.trim() : '';
          if (!title || !url) {
            return null;
          }
          const description =
            typeof resource.description === 'string' ? resource.description.trim() : undefined;
          const resourceId =
            typeof resource.id === 'string' && resource.id
              ? resource.id
              : createRandomId(`resource-${index}`);
          return { id: resourceId, title, url, description };
        })
        .filter((resource): resource is TrainingResource => Boolean(resource))
    : [];

  return {
    id,
    title: typeof data?.title === 'string' ? data.title : 'Untitled module',
    summary: typeof data?.summary === 'string' ? data.summary : '',
    category: typeof data?.category === 'string' ? data.category : null,
    keywords,
    audiences,
    heroImageUrl: typeof data?.heroImageUrl === 'string' ? data.heroImageUrl : null,
    estimatedDuration:
      typeof data?.estimatedDuration === 'string' ? data.estimatedDuration : null,
    content,
    resources,
    createdAt: data?.createdAt ?? null,
    updatedAt: data?.updatedAt ?? null,
    publishedAt: data?.publishedAt ?? null,
  };
}

export function sortTrainingModules(modules: TrainingModuleRecord[]): TrainingModuleRecord[] {
  return [...modules].sort((a, b) => {
    const aDate = timestampToDate(a.publishedAt ?? a.updatedAt ?? a.createdAt);
    const bDate = timestampToDate(b.publishedAt ?? b.updatedAt ?? b.createdAt);
    if (!aDate && !bDate) return a.title.localeCompare(b.title);
    if (!bDate) return -1;
    if (!aDate) return 1;
    return bDate.getTime() - aDate.getTime();
  });
}

export function stringifyKeywords(keywords: string[]): string {
  return keywords.join(', ');
}

export function parseKeywords(input: string): string[] {
  return input
    .split(',')
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}
