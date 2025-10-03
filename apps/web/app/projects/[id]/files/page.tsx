"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";

import PortalContainer from "@/components/PortalContainer";
import DriveProjectFolderViewer from "@/components/storage/DriveProjectFolderViewer";
import { db } from "@/lib/firebase";

interface OrderDriveSummary {
  id: string | null;
  status: string | null;
  folderName: string | null;
  folderId: string | null;
}

export default function ProjectFilesPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [orderSummary, setOrderSummary] = useState<OrderDriveSummary>({
    id: null,
    status: null,
    folderName: null,
    folderId: null,
  });

  useEffect(() => {
    if (!projectId) {
      return;
    }
    let active = true;

    (async () => {
      try {
        const projectSnap = await getDoc(doc(db, "projects", projectId));
        if (!projectSnap.exists()) {
          if (active) {
            setLoading(false);
          }
          return;
        }

        const projectData = projectSnap.data() as Record<string, any>;
        if (active) {
          setProjectName(
            typeof projectData.name === "string" && projectData.name.trim().length > 0
              ? projectData.name.trim()
              : null
          );
        }

        const orderId = typeof projectData.orderId === "string" ? projectData.orderId : null;
        if (!orderId) {
          if (active) {
            setLoading(false);
          }
          return;
        }

        const orderSnap = await getDoc(doc(db, "orders", orderId));
        if (orderSnap.exists() && active) {
          const orderData = orderSnap.data() as Record<string, any>;
          const driveInfo = (orderData.drive as Record<string, any>) || {};
          setOrderSummary({
            id: orderSnap.id,
            status:
              typeof orderData.status === "string" && orderData.status.trim().length > 0
                ? orderData.status.trim()
                : null,
            folderName:
              typeof driveInfo.orderFolderName === "string" && driveInfo.orderFolderName.trim().length > 0
                ? driveInfo.orderFolderName.trim()
                : null,
            folderId:
              typeof driveInfo.orderFolderId === "string" && driveInfo.orderFolderId.trim().length > 0
                ? driveInfo.orderFolderId.trim()
                : null,
          });
        }
      } catch (error) {
        console.error("Failed to load project Drive metadata", error);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [projectId]);

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-gray-900">Project files</h1>
          {projectName ? (
            <p className="text-sm text-gray-600">Browse the shared Drive folder for {projectName}.</p>
          ) : (
            <p className="text-sm text-gray-600">Browse the shared Drive folder for this project.</p>
          )}
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4 shadow-sm">
          {loading ? (
            <p className="text-sm text-gray-600">Checking the linked Drive folder…</p>
          ) : orderSummary.folderName ? (
            <div className="grid gap-1 text-sm text-gray-700">
              <p>
                <span className="font-semibold">Linked folder:</span> {orderSummary.folderName}
              </p>
              {orderSummary.status ? (
                <p className="text-xs text-gray-500">Order status: {orderSummary.status}</p>
              ) : null}
              <p className="text-xs text-gray-500">
                Only Pineapple Tapped staff, franchise operators, and approved members of your organisation can access these
                files.
              </p>
            </div>
          ) : (
            <div className="grid gap-1 text-sm text-gray-700">
              <p>
                The Drive folder for this project is still being provisioned. You will see shared files here once the delivery team
                has prepared them.
              </p>
              <p className="text-xs text-gray-500">
                If you believe this is incorrect, contact your Pineapple Tapped producer for assistance.
              </p>
            </div>
          )}
        </div>

        <DriveProjectFolderViewer projectId={projectId} initialFolderId={orderSummary.folderId} />
      </div>
    </PortalContainer>
  );
}
