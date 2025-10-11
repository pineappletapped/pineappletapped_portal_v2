"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";

import {
  NoticeBoardNotice,
  NoticeBoardPermission,
  useNoticeBoardControls,
} from "@/hooks/useNoticeBoardControls";

type NoticeStatus = "active" | "hidden";

interface NoticeBoardControlProps {
  filterUser?: (userData: any, uid: string) => boolean;
  renderSection?: (section: NoticeBoardSection) => ReactNode;
  showPermissions?: boolean;
}

export interface NoticeBoardSection {
  key: string;
  title: string;
  description?: string;
  content: ReactNode;
  tone?: "default" | "muted" | "info" | "danger" | "success";
}

const formatDateTime = (value: Date | null): string => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
};

const defaultRenderSection = (section: NoticeBoardSection) => (
  <section
    key={section.key}
    className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
  >
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
        {section.description ? (
          <p className="text-sm text-slate-600">{section.description}</p>
        ) : null}
      </div>
      <div className="space-y-4">{section.content}</div>
    </div>
  </section>
);

const resolveNoticeStatusBadge = (notice: NoticeBoardNotice) => {
  if (notice.status === "hidden") {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">
        Hidden
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
      Live
    </span>
  );
};

const resolvePermissionStatusLabel = (permission: NoticeBoardPermission) => {
  switch (permission.statusLabel) {
    case "restricted":
      return (
        <span className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
          Restricted
        </span>
      );
    case "allowed":
      return (
        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          Allowed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">
          Override
        </span>
      );
  }
};

export default function NoticeBoardControl({
  filterUser,
  renderSection = defaultRenderSection,
  showPermissions = true,
}: NoticeBoardControlProps) {
  const {
    notices,
    permissions,
    loadingNotices,
    loadingPermissions,
    error,
    createNotice,
    updateNotice,
    setNoticeStatus,
    removeNotice,
    setPermission,
    clearPermission,
    setPermissionByEmail,
  } = useNoticeBoardControls({ filterUser });

  const [composerId, setComposerId] = useState<string | null>(null);
  const [composerTitle, setComposerTitle] = useState("");
  const [composerMessage, setComposerMessage] = useState("");
  const [composerStatus, setComposerStatus] = useState<NoticeStatus>("active");
  const [composerBusy, setComposerBusy] = useState(false);
  const [permissionEmail, setPermissionEmail] = useState("");
  const [permissionMode, setPermissionMode] = useState<"restrict" | "allow">("restrict");
  const [permissionReason, setPermissionReason] = useState("");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const editingNotice = useMemo(
    () => (composerId ? notices.find((notice) => notice.id === composerId) ?? null : null),
    [composerId, notices]
  );

  const resetComposer = useCallback(() => {
    setComposerId(null);
    setComposerTitle("");
    setComposerMessage("");
    setComposerStatus("active");
  }, []);

  const startEditing = useCallback((notice: NoticeBoardNotice) => {
    setComposerId(notice.id);
    setComposerTitle(notice.title);
    setComposerMessage(notice.message);
    setComposerStatus(notice.status);
  }, []);

  const handleComposerSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setLocalError(null);
      const trimmedTitle = composerTitle.trim();
      const trimmedMessage = composerMessage.trim();
      if (!trimmedTitle || !trimmedMessage) {
        setLocalError("Enter a title and message before publishing.");
        return;
      }

      try {
        setComposerBusy(true);
        if (composerId) {
          await updateNotice(composerId, {
            title: trimmedTitle,
            message: trimmedMessage,
            status: composerStatus,
          });
        } else {
          await createNotice({
            title: trimmedTitle,
            message: trimmedMessage,
            status: composerStatus,
          });
        }
        resetComposer();
      } catch (submitError: any) {
        console.warn("Failed to save notice", submitError);
        setLocalError(submitError?.message || "We couldn't save the notice. Please try again.");
      } finally {
        setComposerBusy(false);
      }
    },
    [composerId, composerMessage, composerStatus, composerTitle, createNotice, resetComposer, updateNotice]
  );

  const handleStatusChange = useCallback(
    async (notice: NoticeBoardNotice, status: NoticeStatus) => {
      try {
        await setNoticeStatus(notice.id, status);
      } catch (statusError: any) {
        console.warn("Failed to update notice status", statusError);
        setLocalError(statusError?.message || "We couldn't update that notice. Try again.");
      }
    },
    [setNoticeStatus]
  );

  const handleDelete = useCallback(
    async (notice: NoticeBoardNotice) => {
      if (!confirm(`Delete the notice "${notice.title}"?`)) return;
      try {
        await removeNotice(notice.id);
        if (composerId === notice.id) {
          resetComposer();
        }
      } catch (deleteError: any) {
        console.warn("Failed to delete notice", deleteError);
        setLocalError(deleteError?.message || "We couldn't delete that notice. Please retry.");
      }
    },
    [composerId, removeNotice, resetComposer]
  );

  const handlePermissionSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setLocalError(null);
      const trimmedEmail = permissionEmail.trim();
      if (!trimmedEmail) {
        setLocalError("Enter a user email before updating permissions.");
        return;
      }
      try {
        setPermissionBusy(true);
        await setPermissionByEmail(
          trimmedEmail,
          permissionMode === "allow" ? true : false,
          permissionReason.trim() || undefined
        );
        setPermissionEmail("");
        setPermissionReason("");
      } catch (permissionError: any) {
        console.warn("Failed to set permission", permissionError);
        setLocalError(
          permissionError?.message || "We couldn't update that posting permission yet."
        );
      } finally {
        setPermissionBusy(false);
      }
    },
    [permissionEmail, permissionMode, permissionReason, setPermissionByEmail]
  );

  const handlePermissionToggle = useCallback(
    async (permission: NoticeBoardPermission, allowPost: boolean | null) => {
      try {
        await setPermission(permission.id, allowPost, permission.reason ?? undefined);
      } catch (permissionError: any) {
        console.warn("Failed to update permission", permissionError);
        setLocalError(
          permissionError?.message || "We couldn't update that user's notice access right now."
        );
      }
    },
    [setPermission]
  );

  const handlePermissionClear = useCallback(
    async (permission: NoticeBoardPermission) => {
      try {
        await clearPermission(permission.id);
      } catch (permissionError: any) {
        console.warn("Failed to clear permission", permissionError);
        setLocalError(
          permissionError?.message || "We couldn't clear that override yet. Please try again."
        );
      }
    },
    [clearPermission]
  );

  const sections: NoticeBoardSection[] = useMemo(() => {
    const allSections: NoticeBoardSection[] = [];

    allSections.push({
      key: "composer",
      title: composerId ? "Edit notice" : "Post a new notice",
      description:
        "Share important updates with the production team. You can hide notices without deleting them if plans change.",
      content: (
        <form className="space-y-4" onSubmit={handleComposerSubmit}>
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="notice-title-input">
              Title
            </label>
            <input
              id="notice-title-input"
              value={composerTitle}
              onChange={(event) => setComposerTitle(event.target.value)}
              className="input"
              placeholder="What's the headline?"
              required
              disabled={composerBusy}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="notice-message-input">
              Message
            </label>
            <textarea
              id="notice-message-input"
              value={composerMessage}
              onChange={(event) => setComposerMessage(event.target.value)}
              className="textarea"
              rows={6}
              placeholder="Add the detail your team needs."
              required
              disabled={composerBusy}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="notice-status-input">
              Visibility
            </label>
            <select
              id="notice-status-input"
              value={composerStatus}
              onChange={(event) => setComposerStatus(event.target.value as NoticeStatus)}
              className="input"
              disabled={composerBusy}
            >
              <option value="active">Visible to the team</option>
              <option value="hidden">Hidden for now</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn" disabled={composerBusy}>
              {composerBusy ? "Saving…" : composerId ? "Update notice" : "Publish notice"}
            </button>
            {composerId ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={resetComposer}
                disabled={composerBusy}
              >
                Cancel editing
              </button>
            ) : null}
          </div>
        </form>
      ),
    });

    allSections.push({
      key: "notices",
      title: "Recent notices",
      description:
        loadingNotices
          ? "Loading notices from Firestore…"
          : "Manage previously published updates. Hide or delete posts when they're no longer relevant.",
      content: loadingNotices ? (
        <p className="text-sm text-slate-600">Loading notices…</p>
      ) : notices.length ? (
        <ul className="space-y-4">
          {notices.map((notice) => (
            <li
              key={notice.id}
              className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{notice.title || "Untitled notice"}</h3>
                    {resolveNoticeStatusBadge(notice)}
                  </div>
                  <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                    Posted {formatDateTime(notice.createdAt)}
                    {notice.authorName ? ` by ${notice.authorName}` : ""}
                  </p>
                  <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{notice.message}</p>
                </div>
                <div className="flex flex-col gap-2 text-sm">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => startEditing(notice)}
                  >
                    Edit
                  </button>
                  {notice.status === "hidden" ? (
                    <button
                      type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleStatusChange(notice, "active")}
                  >
                    Show
                  </button>
                  ) : (
                    <button
                      type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => handleStatusChange(notice, "hidden")}
                  >
                    Hide
                  </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDelete(notice)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-600">No notices yet. Use the composer above to share your first update.</p>
      ),
    });

    if (showPermissions) {
      allSections.push({
        key: "permissions",
        title: "Posting permissions",
        description:
          loadingPermissions
            ? "Loading overrides…"
            : "Restrict or grant access for teammates who need to post updates on behalf of HQ.",
        content: (
          <div className="space-y-4">
            <form className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:items-end" onSubmit={handlePermissionSubmit}>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="permission-email-input">
                  User email
                </label>
                <input
                  id="permission-email-input"
                  type="email"
                  className="input"
                  value={permissionEmail}
                  onChange={(event) => setPermissionEmail(event.target.value)}
                  placeholder="team.member@example.com"
                  required
                  disabled={permissionBusy}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700">Action</label>
                <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="permission-action"
                      value="restrict"
                      checked={permissionMode === "restrict"}
                      onChange={() => setPermissionMode("restrict")}
                      disabled={permissionBusy}
                    />
                    Restrict posting
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="permission-action"
                      value="allow"
                      checked={permissionMode === "allow"}
                      onChange={() => setPermissionMode("allow")}
                      disabled={permissionBusy}
                    />
                    Allow posting
                  </label>
                </div>
              </div>
              <div className="md:col-span-2 grid gap-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="permission-reason-input">
                  Note (optional)
                </label>
                <input
                  id="permission-reason-input"
                  className="input"
                  value={permissionReason}
                  onChange={(event) => setPermissionReason(event.target.value)}
                  placeholder="Why is this override needed?"
                  disabled={permissionBusy}
                />
              </div>
              <div className="md:col-span-2">
                <button type="submit" className="btn" disabled={permissionBusy}>
                  {permissionBusy ? "Saving…" : "Apply override"}
                </button>
              </div>
            </form>

            {loadingPermissions ? (
              <p className="text-sm text-slate-600">Loading overrides…</p>
            ) : permissions.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Updated</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {permissions.map((permission) => (
                      <tr key={permission.id}>
                        <td className="px-3 py-3">
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-900">
                              {permission.userName || permission.userEmail || "User"}
                            </span>
                            {permission.userEmail ? (
                              <span className="text-xs text-slate-500">{permission.userEmail}</span>
                            ) : null}
                            {permission.reason ? (
                              <span className="mt-1 text-xs text-slate-500">{permission.reason}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-3">{resolvePermissionStatusLabel(permission)}</td>
                        <td className="px-3 py-3 text-xs text-slate-500">
                          {formatDateTime(permission.updatedAt)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => handlePermissionToggle(permission, true)}
                            >
                              Allow
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-secondary"
                              onClick={() => handlePermissionToggle(permission, false)}
                            >
                              Restrict
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => handlePermissionClear(permission)}
                            >
                              Clear
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No overrides yet. Everyone with staff access can post notices by default.</p>
            )}
          </div>
        ),
      });
    }

    return allSections;
  }, [
    composerBusy,
    composerId,
    composerMessage,
    composerStatus,
    composerTitle,
    handleComposerSubmit,
    handleDelete,
    handlePermissionClear,
    handlePermissionSubmit,
    handlePermissionToggle,
    handleStatusChange,
    loadingNotices,
    loadingPermissions,
    notices,
    permissionBusy,
    permissionEmail,
    permissionMode,
    permissionReason,
    permissions,
    resetComposer,
    showPermissions,
    startEditing,
  ]);

  return (
    <div className="space-y-6">
      {(error || localError) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {localError || error}
        </div>
      )}
      {sections.map((section) => renderSection(section))}
    </div>
  );
}

