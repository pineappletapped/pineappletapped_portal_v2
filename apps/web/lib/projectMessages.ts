export type ProjectMessageThreadId = 'client' | 'production' | 'oversight';

export type ProjectMessageAudience = 'client' | 'team' | 'oversight';

export interface ProjectMessageThreadDefinition {
  id: ProjectMessageThreadId;
  label: string;
  description: string;
  participants: string[];
  requiresStaffAccess?: boolean;
  oversightOnly?: boolean;
  legacyCollection?: 'messages' | 'contractorMessages';
  notifyOrgMembers?: boolean;
}

export interface ProjectMessageRecord {
  id: string;
  projectId: string | null;
  threadId: ProjectMessageThreadId;
  body: string;
  createdAt: Date | null;
  fromUid: string | null;
  fromName: string | null;
  fromEmail: string | null;
  audience: ProjectMessageAudience;
  source: 'projectMessages' | 'legacy';
}

export const PROJECT_MESSAGE_THREADS: ReadonlyArray<ProjectMessageThreadDefinition> = [
  {
    id: 'client',
    label: 'Client collaboration',
    description: 'Share updates with the client and keep the managing franchise in the loop.',
    participants: ['Client team', 'Managing franchise', 'HQ operations', 'Invited production crew'],
    notifyOrgMembers: true,
  },
  {
    id: 'production',
    label: 'Production team',
    description: 'Coordinate logistics internally across the franchise crew and HQ support.',
    participants: ['Managing franchise', 'Assigned crew members', 'HQ operations'],
    requiresStaffAccess: true,
    legacyCollection: 'contractorMessages',
  },
  {
    id: 'oversight',
    label: 'HQ oversight',
    description: 'Escalations, compliance updates, and leadership-only notes.',
    participants: ['HQ operations', 'Leadership'],
    requiresStaffAccess: true,
    oversightOnly: true,
  },
] as const;

export const projectMessageTimestampFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const normaliseProjectMessageDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof candidate.toDate === 'function') {
      try {
        const date = candidate.toDate();
        if (date instanceof Date && !Number.isNaN(date.getTime())) {
          return date;
        }
      } catch (error) {
        console.warn('Failed to convert Firestore timestamp via toDate', error);
      }
    }
    if (typeof candidate.seconds === 'number' && typeof candidate.nanoseconds === 'number') {
      const milliseconds = candidate.seconds * 1000 + Math.floor(candidate.nanoseconds / 1_000_000);
      const date = new Date(milliseconds);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  return null;
};

export const createProjectMessageRecord = (
  id: string,
  raw: Record<string, any>,
  fallbackThreadId: ProjectMessageThreadId,
  source: 'projectMessages' | 'legacy'
): ProjectMessageRecord => {
  const threadId =
    typeof raw.threadId === 'string' && raw.threadId.trim().length > 0
      ? (raw.threadId.trim() as ProjectMessageThreadId)
      : fallbackThreadId;
  const projectId = typeof raw.projectId === 'string' ? raw.projectId : null;
  const body = typeof raw.body === 'string' ? raw.body : '';
  const createdAt = normaliseProjectMessageDate(raw.createdAt ?? raw.timestamp ?? raw.created_at);
  const fromUid = typeof raw.fromUid === 'string' ? raw.fromUid : typeof raw.uid === 'string' ? raw.uid : null;
  const fromName =
    typeof raw.fromName === 'string'
      ? raw.fromName
      : typeof raw.author === 'string'
        ? raw.author
        : typeof raw.senderName === 'string'
          ? raw.senderName
          : null;
  const fromEmail = typeof raw.fromEmail === 'string' ? raw.fromEmail : null;
  const audience: ProjectMessageAudience = raw.audience === 'oversight'
    ? 'oversight'
    : raw.audience === 'team'
      ? 'team'
      : 'client';

  return {
    id,
    projectId,
    threadId,
    body,
    createdAt,
    fromUid,
    fromName,
    fromEmail,
    audience,
    source,
  } satisfies ProjectMessageRecord;
};

export const getThreadDefinition = (
  id: ProjectMessageThreadId
): ProjectMessageThreadDefinition | undefined => {
  return PROJECT_MESSAGE_THREADS.find((thread) => thread.id === id);
};
