"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";

type NoticeStatus = "active" | "hidden";

interface NoticeDoc {
  title?: string | null;
  message?: string | null;
  status?: string | null;
  createdAt?: any;
  updatedAt?: any;
  authorUid?: string | null;
  updatedBy?: string | null;
}

interface PermissionDoc {
  allowPost?: boolean | null;
  reason?: string | null;
  updatedAt?: any;
  updatedBy?: string | null;
}

export interface NoticeBoardNotice {
  id: string;
  title: string;
  message: string;
  status: NoticeStatus;
  createdAt: Date | null;
  updatedAt: Date | null;
  authorUid: string | null;
  authorName: string | null;
  authorEmail: string | null;
  updatedBy: string | null;
}

export interface NoticeBoardPermission {
  id: string;
  allowPost: boolean | null;
  statusLabel: "allowed" | "restricted" | "custom";
  updatedAt: Date | null;
  updatedBy: string | null;
  reason: string | null;
  userName: string | null;
  userEmail: string | null;
}

export interface UseNoticeBoardControlsOptions {
  filterUser?: (userData: DocumentData | null, uid: string) => boolean;
  noticeLimit?: number;
}

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value === "string") {
    const fromString = new Date(value);
    return Number.isNaN(fromString.getTime()) ? null : fromString;
  }
  if (value && typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch (error) {
      console.warn("toDate failed", error);
      return null;
    }
  }
  return null;
};

const resolveUserName = (userData: DocumentData | null): string | null => {
  if (!userData || typeof userData !== "object") {
    return null;
  }

  const fullName = userData.fullName;
  if (typeof fullName === "string" && fullName.trim().length > 0) {
    return fullName.trim();
  }

  const displayName = userData.displayName;
  if (typeof displayName === "string" && displayName.trim().length > 0) {
    return displayName.trim();
  }

  const firstName = userData.firstName;
  const lastName = userData.lastName;
  if (
    typeof firstName === "string" &&
    firstName.trim().length > 0 &&
    typeof lastName === "string" &&
    lastName.trim().length > 0
  ) {
    return `${firstName.trim()} ${lastName.trim()}`;
  }

  if (typeof firstName === "string" && firstName.trim().length > 0) {
    return firstName.trim();
  }

  const contractorName = userData.contractorInfo?.name;
  if (typeof contractorName === "string" && contractorName.trim().length > 0) {
    return contractorName.trim();
  }

  const email = userData.email;
  if (typeof email === "string" && email.trim().length > 0) {
    return email.trim();
  }

  return null;
};

const normaliseStatus = (status: string | null | undefined): NoticeStatus => {
  return status === "hidden" ? "hidden" : "active";
};

const normaliseEmail = (value: string): string => value.trim();

const NOTICE_LIMIT_DEFAULT = 100;

export function useNoticeBoardControls({
  filterUser,
  noticeLimit = NOTICE_LIMIT_DEFAULT,
}: UseNoticeBoardControlsOptions = {}) {
  const [notices, setNotices] = useState<NoticeBoardNotice[]>([]);
  const [permissions, setPermissions] = useState<NoticeBoardPermission[]>([]);
  const [loadingNotices, setLoadingNotices] = useState(false);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotices = useCallback(async () => {
    setLoadingNotices(true);
    try {
      const snap = await getDocs(
        query(collection(db, "teamNotices"), orderBy("createdAt", "desc"), limit(noticeLimit))
      );
      const raw = snap.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() as NoticeDoc }));

      const authorIds = Array.from(
        new Set(
          raw
            .map((item) => (typeof item.data.authorUid === "string" ? item.data.authorUid : null))
            .filter((uid): uid is string => Boolean(uid))
        )
      );

      const authorSnaps = await Promise.all(
        authorIds.map(async (uid) => {
          try {
            return await getDoc(doc(db, "users", uid));
          } catch (authorError) {
            console.warn("Failed to load author", uid, authorError);
            return null;
          }
        })
      );

      const authorMap = new Map<string, DocumentData | null>();
      authorSnaps.forEach((snap, index) => {
        const uid = authorIds[index];
        if (snap && snap.exists()) {
          authorMap.set(uid, snap.data());
        } else {
          authorMap.set(uid, null);
        }
      });

      const items: NoticeBoardNotice[] = raw.map(({ id, data }) => {
        const authorUid = typeof data.authorUid === "string" ? data.authorUid : null;
        const authorData = authorUid ? authorMap.get(authorUid) ?? null : null;
        const createdAt = toDate(data.createdAt);
        const updatedAt = toDate(data.updatedAt);
        return {
          id,
          title: typeof data.title === "string" ? data.title : "",
          message: typeof data.message === "string" ? data.message : "",
          status: normaliseStatus(data.status),
          createdAt,
          updatedAt,
          authorUid,
          authorName: resolveUserName(authorData),
          authorEmail:
            authorData && typeof authorData.email === "string" ? authorData.email : null,
          updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
        };
      });

      items.sort((a, b) => {
        const aDate = a.updatedAt?.getTime() ?? a.createdAt?.getTime() ?? 0;
        const bDate = b.updatedAt?.getTime() ?? b.createdAt?.getTime() ?? 0;
        return bDate - aDate;
      });

      setNotices(items);
    } catch (noticeError: any) {
      console.warn("Failed to load team notices", noticeError);
      setError(
        noticeError?.message || "We couldn't load the notice board posts. Please try again."
      );
    } finally {
      setLoadingNotices(false);
    }
  }, [noticeLimit]);

  const loadPermissions = useCallback(async () => {
    setLoadingPermissions(true);
    try {
      const snap = await getDocs(collection(db, "teamNoticePermissions"));
      const raw = snap.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() as PermissionDoc }));

      const userSnaps = await Promise.all(
        raw.map(async (item) => {
          try {
            const userSnap = await getDoc(doc(db, "users", item.id));
            return userSnap.exists() ? userSnap : null;
          } catch (userError) {
            console.warn("Failed to load user for notice permission", item.id, userError);
            return null;
          }
        })
      );

      const entries: NoticeBoardPermission[] = [];
      raw.forEach((item, index) => {
        const userSnap = userSnaps[index];
        const userData = userSnap ? userSnap.data() : null;

        if (filterUser && !filterUser(userData, item.id)) {
          return;
        }

        const allowPost =
          typeof item.data.allowPost === "boolean" ? item.data.allowPost : null;
        const statusLabel: NoticeBoardPermission["statusLabel"] = allowPost === false
          ? "restricted"
          : allowPost === true
          ? "allowed"
          : "custom";

        entries.push({
          id: item.id,
          allowPost,
          statusLabel,
          updatedAt: toDate(item.data.updatedAt),
          updatedBy: typeof item.data.updatedBy === "string" ? item.data.updatedBy : null,
          reason: typeof item.data.reason === "string" ? item.data.reason : null,
          userName: resolveUserName(userData),
          userEmail:
            userData && typeof userData.email === "string" ? userData.email : null,
        });
      });

      entries.sort((a, b) => {
        const nameA = (a.userName || a.userEmail || "").toLowerCase();
        const nameB = (b.userName || b.userEmail || "").toLowerCase();
        return nameA.localeCompare(nameB);
      });

      setPermissions(entries);
    } catch (permissionError: any) {
      console.warn("Failed to load notice permissions", permissionError);
      setError(
        permissionError?.message ||
          "We couldn't load notice posting permissions. Please refresh the page."
      );
    } finally {
      setLoadingPermissions(false);
    }
  }, [filterUser]);

  useEffect(() => {
    void loadNotices();
  }, [loadNotices]);

  useEffect(() => {
    void loadPermissions();
  }, [loadPermissions]);

  const createNotice = useCallback(
    async (input: { title: string; message: string; status?: NoticeStatus }) => {
      const user = auth.currentUser;
      const payload: NoticeDoc = {
        title: input.title.trim(),
        message: input.message.trim(),
        status: input.status ?? "active",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        authorUid: user?.uid ?? null,
        updatedBy: user?.uid ?? null,
      };
      await addDoc(collection(db, "teamNotices"), payload);
      await loadNotices();
    },
    [loadNotices]
  );

  const updateNotice = useCallback(
    async (
      noticeId: string,
      updates: { title?: string; message?: string; status?: NoticeStatus }
    ) => {
      const user = auth.currentUser;
      const docRef = doc(db, "teamNotices", noticeId);
      const payload: Record<string, unknown> = {
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      };
      if (typeof updates.title === "string") {
        payload.title = updates.title.trim();
      }
      if (typeof updates.message === "string") {
        payload.message = updates.message.trim();
      }
      if (typeof updates.status === "string") {
        payload.status = updates.status;
      }
      await updateDoc(docRef, payload);
      await loadNotices();
    },
    [loadNotices]
  );

  const setNoticeStatus = useCallback(
    async (noticeId: string, status: NoticeStatus) => {
      await updateNotice(noticeId, { status });
    },
    [updateNotice]
  );

  const removeNotice = useCallback(
    async (noticeId: string) => {
      await deleteDoc(doc(db, "teamNotices", noticeId));
      await loadNotices();
    },
    [loadNotices]
  );

  const setPermission = useCallback(
    async (uid: string, allowPost: boolean | null, reason?: string | null) => {
      if (!uid) {
        throw new Error("Select a user before updating permissions.");
      }
      const user = auth.currentUser;
      const payload: PermissionDoc & { uid: string } = {
        uid,
        allowPost,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid ?? null,
      };
      if (typeof reason === "string" && reason.trim().length > 0) {
        payload.reason = reason.trim();
      }
      await setDoc(doc(db, "teamNoticePermissions", uid), payload, { merge: true });
      await loadPermissions();
    },
    [loadPermissions]
  );

  const clearPermission = useCallback(
    async (uid: string) => {
      await deleteDoc(doc(db, "teamNoticePermissions", uid));
      await loadPermissions();
    },
    [loadPermissions]
  );

  const setPermissionByEmail = useCallback(
    async (email: string, allowPost: boolean | null, reason?: string | null) => {
      const trimmed = normaliseEmail(email);
      if (!trimmed) {
        throw new Error("Enter an email address.");
      }

      const lower = trimmed.toLowerCase();
      let candidate = await getDocs(query(collection(db, "users"), where("email", "==", trimmed)));
      if (candidate.empty) {
        candidate = await getDocs(
          query(collection(db, "users"), where("email", "==", lower))
        );
      }
      if (candidate.empty) {
        candidate = await getDocs(
          query(collection(db, "users"), where("emailLower", "==", lower))
        );
      }

      if (candidate.empty) {
        throw new Error("We couldn't find a user with that email.");
      }

      const docSnap = candidate.docs[0];
      const userData = docSnap.data();
      if (filterUser && !filterUser(userData, docSnap.id)) {
        throw new Error("You don't have permission to manage notice access for this user.");
      }

      await setPermission(docSnap.id, allowPost, reason);
      return docSnap.id;
    },
    [filterUser, setPermission]
  );

  const state = useMemo(
    () => ({
      notices,
      permissions,
      loadingNotices,
      loadingPermissions,
      error,
    }),
    [notices, permissions, loadingNotices, loadingPermissions, error]
  );

  return {
    ...state,
    refreshNotices: loadNotices,
    refreshPermissions: loadPermissions,
    createNotice,
    updateNotice,
    setNoticeStatus,
    removeNotice,
    setPermission,
    clearPermission,
    setPermissionByEmail,
  };
}

