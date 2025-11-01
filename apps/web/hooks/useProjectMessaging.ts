import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDoc, collection, getDocs, query, serverTimestamp, where, type Firestore } from 'firebase/firestore';
import type { Auth } from 'firebase/auth';
import {
  PROJECT_MESSAGE_THREADS,
  createProjectMessageRecord,
  getThreadDefinition,
  projectMessageTimestampFormatter,
  type ProjectMessageRecord,
  type ProjectMessageThreadDefinition,
  type ProjectMessageThreadId,
} from '@/lib/projectMessages';

export type { ProjectMessageThreadId, ProjectMessageThreadDefinition, ProjectMessageRecord };

interface UseProjectMessagingOptions {
  firestore?: Firestore | null;
  auth?: Auth | null;
  projectId: string;
  projectName?: string | null;
  organisationId?: string | null;
  isStaffUser?: boolean;
}

interface MessageFeedback {
  kind: 'success' | 'error';
  message: string;
}

export interface UseProjectMessagingResult {
  threads: ProjectMessageThreadDefinition[];
  activeThreadId: ProjectMessageThreadId;
  setActiveThreadId: (id: ProjectMessageThreadId) => void;
  activeThread?: ProjectMessageThreadDefinition;
  messages: ProjectMessageRecord[];
  loading: boolean;
  sending: boolean;
  error: string | null;
  feedback: MessageFeedback | null;
  draft: string;
  setDraft: (value: string) => void;
  refresh: () => Promise<void>;
  sendMessage: () => Promise<void>;
}

const defaultThreadId: ProjectMessageThreadId = 'client';

export function useProjectMessaging(options: UseProjectMessagingOptions): UseProjectMessagingResult {
  const { firestore, auth, projectId, projectName, organisationId, isStaffUser } = options;
  const ready = Boolean(firestore && auth);
  const [activeThreadId, setActiveThreadId] = useState<ProjectMessageThreadId>(defaultThreadId);
  const [messagesMap, setMessagesMap] = useState<Partial<Record<ProjectMessageThreadId, ProjectMessageRecord[]>>>({});
  const [drafts, setDrafts] = useState<Partial<Record<ProjectMessageThreadId, string>>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<MessageFeedback | null>(null);

  const availableThreads = useMemo(() => {
    return PROJECT_MESSAGE_THREADS.filter((thread) => !thread.requiresStaffAccess || Boolean(isStaffUser));
  }, [isStaffUser]);

  useEffect(() => {
    if (availableThreads.length === 0) {
      setActiveThreadId(defaultThreadId);
      return;
    }
    const current = availableThreads.find((thread) => thread.id === activeThreadId);
    if (!current) {
      setActiveThreadId(availableThreads[0].id);
    }
  }, [availableThreads, activeThreadId]);

  useEffect(() => {
    setMessagesMap({});
    setDrafts({});
  }, [projectId]);

  const loadThread = useCallback(
    async (threadId: ProjectMessageThreadId) => {
      if (!firestore) return;
      const thread = getThreadDefinition(threadId);
      if (!thread) return;

      setLoading(true);
      setError(null);
      try {
        const baseQuery = query(collection(firestore, 'projectMessages'), where('projectId', '==', projectId));
        const baseSnapshot = await getDocs(baseQuery);
        const hydrated = baseSnapshot.docs
          .map((docSnap) => createProjectMessageRecord(docSnap.id, docSnap.data() as Record<string, any>, threadId, 'projectMessages'))
          .filter((record) => record.threadId === threadId);

        let messages = hydrated;

        if (messages.length === 0 && thread.legacyCollection) {
          const legacyQuery = query(collection(firestore, thread.legacyCollection), where('projectId', '==', projectId));
          const legacySnapshot = await getDocs(legacyQuery);
          messages = legacySnapshot.docs.map((docSnap) =>
            createProjectMessageRecord(docSnap.id, docSnap.data() as Record<string, any>, threadId, 'legacy')
          );
        }

        messages.sort((left, right) => {
          const leftTs = left.createdAt?.getTime() ?? 0;
          const rightTs = right.createdAt?.getTime() ?? 0;
          return leftTs - rightTs;
        });

        setMessagesMap((prev) => ({ ...prev, [threadId]: messages }));
      } catch (err) {
        console.error('Failed to load project messages', err);
        setError('Unable to load conversation history. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [firestore, projectId]
  );

  useEffect(() => {
    if (!ready) return;
    void loadThread(activeThreadId);
  }, [ready, activeThreadId, loadThread]);

  const activeThread = useMemo(
    () => availableThreads.find((thread) => thread.id === activeThreadId),
    [availableThreads, activeThreadId]
  );

  const messages = useMemo(() => messagesMap[activeThreadId] ?? [], [messagesMap, activeThreadId]);
  const draft = drafts[activeThreadId] ?? '';

  const setDraft = useCallback(
    (value: string) => {
      setDrafts((prev) => ({ ...prev, [activeThreadId]: value }));
    },
    [activeThreadId]
  );

  const refresh = useCallback(async () => {
    if (!ready) return;
    await loadThread(activeThreadId);
  }, [ready, loadThread, activeThreadId]);

  const sendMessage = useCallback(async () => {
    if (!ready) {
      setFeedback({ kind: 'error', message: 'Messaging is unavailable while offline.' });
      return;
    }

    const thread = getThreadDefinition(activeThreadId);
    if (!thread) {
      setFeedback({ kind: 'error', message: 'This conversation is no longer available.' });
      return;
    }

    const content = (drafts[activeThreadId] ?? '').trim();
    if (!content) {
      setFeedback({ kind: 'error', message: 'Please enter a message before sending.' });
      return;
    }

    const user = auth?.currentUser;
    if (!user) {
      setFeedback({ kind: 'error', message: 'You must be signed in to send messages.' });
      return;
    }

    setSending(true);
    setFeedback(null);

    try {
      const audience: 'client' | 'team' | 'oversight' = thread.oversightOnly
        ? 'oversight'
        : thread.requiresStaffAccess
          ? 'team'
          : 'client';

      await addDoc(collection(firestore!, 'projectMessages'), {
        projectId,
        threadId: thread.id,
        audience,
        body: content,
        createdAt: serverTimestamp(),
        fromUid: user.uid,
        fromName: user.displayName ?? null,
        fromEmail: user.email ?? null,
      });

      if (thread.notifyOrgMembers) {
        const resolvedOrgId = organisationId ?? null;
        if (resolvedOrgId) {
          try {
            const membershipQuery = query(collection(firestore!, 'memberships'), where('orgId', '==', resolvedOrgId));
            const membershipSnapshot = await getDocs(membershipQuery);
            const recipients = membershipSnapshot.docs
              .map((docSnap) => (docSnap.data() as Record<string, any>).userId)
              .filter((value): value is string => typeof value === 'string' && value !== user.uid);
            await Promise.all(
              recipients.map((recipientId) =>
                addDoc(collection(firestore!, 'notifications'), {
                  userId: recipientId,
                  message: `New message on ${projectName || 'a project'}.`,
                  projectId,
                  createdAt: serverTimestamp(),
                })
              )
            );
          } catch (notificationError) {
            console.warn('Failed to deliver message notifications', notificationError);
          }
        }
      }

      setDrafts((prev) => ({ ...prev, [activeThreadId]: '' }));
      setFeedback({ kind: 'success', message: 'Message sent.' });
      await loadThread(activeThreadId);
    } catch (err) {
      console.error('Failed to send project message', err);
      setFeedback({ kind: 'error', message: 'We could not send that message. Please try again.' });
    } finally {
      setSending(false);
    }
  }, [ready, firestore, auth, activeThreadId, drafts, organisationId, projectId, projectName, loadThread]);

  return {
    threads: availableThreads,
    activeThreadId,
    setActiveThreadId,
    activeThread,
    messages,
    loading,
    sending,
    error,
    feedback,
    draft,
    setDraft,
    refresh,
    sendMessage,
  };
}

export const formatProjectMessageTimestamp = (value: Date | null): string => {
  if (!value) return 'Just now';
  return projectMessageTimestampFormatter.format(value);
};
