"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";

export default function AdminStoragePage() {
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "operations"]);
  const [loading, setLoading] = useState(true);
  const [driveRootId, setDriveRootId] = useState("");
  const [driveBrandingName, setDriveBrandingName] = useState("Branding Assets");
  const [driveOrdersName, setDriveOrdersName] = useState("Projects");
  const [driveBrandingTemplateId, setDriveBrandingTemplateId] = useState("");
  const [driveHqEmails, setDriveHqEmails] = useState("");
  const [driveSaving, setDriveSaving] = useState(false);
  const [driveNotice, setDriveNotice] = useState<
    { tone: "success" | "error"; text: string } | null
  >(null);

  useEffect(() => {
    (async () => {
      if (guardLoading) return;
      if (!allowed) {
        setLoading(false);
        return;
      }
      try {
        const driveSnap = await getDoc(doc(db, "settings", "clientDrive"));
        if (driveSnap.exists()) {
          const data = driveSnap.data() as any;
          setDriveRootId(
            typeof data.clientRootFolderId === "string" ? data.clientRootFolderId : ""
          );
          setDriveBrandingName(
            typeof data.brandingFolderName === "string" && data.brandingFolderName.trim().length > 0
              ? data.brandingFolderName
              : "Branding Assets"
          );
          setDriveOrdersName(
            typeof data.ordersFolderName === "string" && data.ordersFolderName.trim().length > 0
              ? data.ordersFolderName
              : "Projects"
          );
          setDriveBrandingTemplateId(
            typeof data.brandingTemplateFolderId === "string"
              ? data.brandingTemplateFolderId
              : ""
          );
          const emails = Array.isArray(data.hqEmails)
            ? data.hqEmails
                .map((value: unknown) => (typeof value === "string" ? value.trim() : ""))
                .filter((value: string) => value.length > 0)
            : [];
          setDriveHqEmails(emails.join(", "));
        } else {
          setDriveRootId("");
          setDriveBrandingTemplateId("");
          setDriveHqEmails("");
          setDriveBrandingName("Branding Assets");
          setDriveOrdersName("Projects");
        }
      } catch (error) {
        console.error("Failed to load drive automation settings", error);
        setDriveNotice({
          tone: "error",
          text: "Unable to load Drive automation settings.",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [allowed, guardLoading]);

  const saveDriveSettings = async () => {
    setDriveSaving(true);
    setDriveNotice(null);
    try {
      const emails = driveHqEmails
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0);
      await setDoc(
        doc(db, "settings", "clientDrive"),
        {
          clientRootFolderId:
            driveRootId.trim().length > 0 ? driveRootId.trim() : null,
          brandingFolderName:
            driveBrandingName.trim().length > 0 ? driveBrandingName.trim() : null,
          ordersFolderName:
            driveOrdersName.trim().length > 0 ? driveOrdersName.trim() : null,
          brandingTemplateFolderId:
            driveBrandingTemplateId.trim().length > 0
              ? driveBrandingTemplateId.trim()
              : null,
          hqEmails: emails,
          updatedAt: new Date(),
        },
        { merge: true }
      );
      setDriveNotice({
        tone: "success",
        text: "Drive automation settings updated.",
      });
    } catch (error) {
      console.error("Failed to save drive settings", error);
      setDriveNotice({
        tone: "error",
        text: "Failed to save Drive automation settings. Please try again.",
      });
    } finally {
      setDriveSaving(false);
    }
  };

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to manage storage settings.</p>;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Storage automation</h1>
        <p className="text-sm text-gray-600">
          Configure Google Drive folder provisioning for new clients and projects.
        </p>
      </header>

      <section className="rounded border bg-slate-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Client Drive automation</h2>
            <p className="text-xs text-gray-600">
              Update the Google Drive folders used when provisioning new client orders.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={saveDriveSettings}
            disabled={driveSaving}
          >
            {driveSaving ? "Saving…" : "Save settings"}
          </button>
        </div>
        <div className="mt-3 grid gap-3">
          <label className="text-xs font-medium text-gray-600">
            Client root folder ID
          </label>
          <input
            className="input"
            placeholder="Drive folder ID (required)"
            value={driveRootId}
            onChange={(event) => setDriveRootId(event.target.value)}
          />
          {driveRootId.trim().length > 0 && (
            <a
              className="text-xs text-blue-600 underline"
              href={`https://drive.google.com/drive/folders/${encodeURIComponent(
                driveRootId.trim()
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              Open root folder
            </a>
          )}
          <label className="text-xs font-medium text-gray-600">
            Branding folder name
          </label>
          <input
            className="input"
            placeholder="Branding Assets"
            value={driveBrandingName}
            onChange={(event) => setDriveBrandingName(event.target.value)}
          />
          <label className="text-xs font-medium text-gray-600">
            Orders/projects folder name
          </label>
          <input
            className="input"
            placeholder="Projects"
            value={driveOrdersName}
            onChange={(event) => setDriveOrdersName(event.target.value)}
          />
          <label className="text-xs font-medium text-gray-600">
            Branding template folder ID (optional)
          </label>
          <input
            className="input"
            placeholder="Folder ID for branding defaults"
            value={driveBrandingTemplateId}
            onChange={(event) => setDriveBrandingTemplateId(event.target.value)}
          />
          {driveBrandingTemplateId.trim().length > 0 && (
            <a
              className="text-xs text-blue-600 underline"
              href={`https://drive.google.com/drive/folders/${encodeURIComponent(
                driveBrandingTemplateId.trim()
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              View branding template
            </a>
          )}
          <label className="text-xs font-medium text-gray-600">
            HQ emails with default access (comma separated)
          </label>
          <textarea
            className="input min-h-[4rem]"
            placeholder="hq@example.com, ops@example.com"
            value={driveHqEmails}
            onChange={(event) => setDriveHqEmails(event.target.value)}
          />
          {driveNotice && (
            <p
              className={`text-xs ${
                driveNotice.tone === "success" ? "text-green-600" : "text-red-600"
              }`}
            >
              {driveNotice.text}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
