"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import PortalContainer from "@/components/PortalContainer";
import DriveAssetStager from "@/components/storage/DriveAssetStager";
import { db } from "@/lib/firebase";
import { useRoleGate } from "@/hooks/useRoleGate";
import { resolveOrderIdentifier } from "@/lib/orders";

interface OrderSummary {
  id: string;
  projectName?: string | null;
  serviceName?: string | null;
  status?: string | null;
  items?: Array<Record<string, any>> | null;
  orderNumber?: number | null;
  orderNumberFormatted?: string | null;
  orderNumberLabel?: string | null;
  orderNumberDisplay?: string | null;
}

export default function AdminDeliveryFormClientPage() {
  const searchParams = useSearchParams();
  const getParam = (key: string): string => (searchParams?.get(key) || "").trim();

  const projectIdParam = getParam("projectId") || getParam("project");
  const orderIdParam = getParam("orderId") || getParam("order");
  const itemIdParam = getParam("itemId");
  const itemNameParam = searchParams?.get("itemName") || "";
  const { allowed, loading: guardLoading } = useRoleGate(["admin", "operations", "projects"]);
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [orderLoading, setOrderLoading] = useState<boolean>(Boolean(orderIdParam));

  useEffect(() => {
    if (!orderIdParam) {
      setOrder(null);
      setOrderLoading(false);
      return;
    }
    let cancelled = false;
    setOrderLoading(true);
    (async () => {
      try {
        const snap = await getDoc(doc(db, "orders", orderIdParam));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as Record<string, any>;
          const orderNumber =
            typeof data?.orderNumber === "number" && Number.isFinite(data.orderNumber)
              ? Math.trunc(data.orderNumber)
              : null;
          const orderNumberFormattedRaw =
            typeof data?.orderNumberFormatted === "string" && data.orderNumberFormatted.trim().length > 0
              ? data.orderNumberFormatted.trim()
              : typeof data?.orderNumberLabel === "string" && data.orderNumberLabel.trim().length > 0
                ? data.orderNumberLabel.trim()
                : null;
          const orderNumberDisplay =
            typeof data?.orderNumberDisplay === "string" && data.orderNumberDisplay.trim().length > 0
              ? data.orderNumberDisplay.trim()
              : orderNumberFormattedRaw
                ? `#${orderNumberFormattedRaw}`
                : null;
          setOrder({
            id: snap.id,
            projectName: data?.projectName || null,
            serviceName: data?.serviceName || null,
            status: data?.status || null,
            items: Array.isArray(data?.items) ? (data.items as Array<Record<string, any>>) : null,
            orderNumber,
            orderNumberFormatted: orderNumberFormattedRaw,
            orderNumberLabel: orderNumberFormattedRaw,
            orderNumberDisplay,
          });
        } else {
          setOrder(null);
        }
      } catch (error) {
        console.error("Failed to load order for delivery staging", error);
        if (!cancelled) {
          setOrder(null);
        }
      } finally {
        if (!cancelled) {
          setOrderLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderIdParam]);

  const selectedItem = useMemo(() => {
    if (!itemIdParam || !order?.items) return null;
    return order.items.find((item) => typeof item?.id === "string" && item.id === itemIdParam) || null;
  }, [itemIdParam, order?.items]);

  const orderIdentifier = useMemo(() => resolveOrderIdentifier(order), [order]);

  const headerTitle = useMemo(() => {
    if (selectedItem?.name) return selectedItem.name as string;
    if (itemNameParam) return itemNameParam;
    if (order?.projectName) return order.projectName;
    if (order?.serviceName) return order.serviceName;
    if (orderIdentifier.friendlyDisplay) return `Order ${orderIdentifier.friendlyDisplay}`;
    if (orderIdentifier.originalId) return `Order ${orderIdentifier.originalId}`;
    if (orderIdParam) return `Order ${orderIdParam}`;
    return "Delivery staging";
  }, [
    itemNameParam,
    order?.projectName,
    order?.serviceName,
    orderIdParam,
    selectedItem?.name,
    orderIdentifier.friendlyDisplay,
    orderIdentifier.originalId,
  ]);

  if (guardLoading) {
    return <p>Loading…</p>;
  }

  if (!allowed) {
    return <p>You do not have permission to stage deliveries.</p>;
  }

  return (
    <PortalContainer>
      <div className="grid gap-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Stage delivery assets</h1>
          <p className="text-sm text-gray-600">
            Pick the files that should ship to the client from the shared Drive folders and publish them into the
            review workspace.
          </p>
        </header>

        <div className="grid gap-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-gray-900">{headerTitle}</h2>
              {orderIdentifier.friendlyDisplay ? (
                <p className="text-sm text-gray-600">Order number: {orderIdentifier.friendlyDisplay}</p>
              ) : orderIdParam ? (
                <p className="text-sm text-gray-600">Order ID: {orderIdParam}</p>
              ) : (
                <p className="text-sm text-gray-600">Select a project to begin staging assets.</p>
              )}
              {orderIdentifier.originalId &&
              orderIdentifier.friendlyDisplay &&
              orderIdentifier.friendlyDisplay !== orderIdentifier.originalId ? (
                <p className="text-[10px] uppercase tracking-wide text-gray-400">
                  Internal ID: {orderIdentifier.originalId}
                </p>
              ) : null}
              {order?.status ? (
                <p className="text-xs uppercase tracking-wide text-gray-500">Order status: {order.status}</p>
              ) : null}
              {selectedItem ? (
                <p className="text-xs text-gray-500">
                  Item ID {selectedItem.id as string}
                  {selectedItem.quantity ? ` · ×${selectedItem.quantity}` : ""}
                </p>
              ) : null}
              {!selectedItem && itemNameParam ? (
                <p className="text-xs text-gray-500">{itemNameParam}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              {projectIdParam ? (
                <Link href={`/admin/projects/${projectIdParam}`} className="btn btn-sm">
                  Open project workspace
                </Link>
              ) : null}
              {orderIdParam ? (
                <Link href={`/admin/orders`} className="btn btn-xs btn-outline">
                  Back to orders
                </Link>
              ) : null}
            </div>
          </div>
          {orderLoading ? <p className="text-sm text-gray-500">Loading order context…</p> : null}
          {order && order.items && order.items.length > 0 ? (
            <div className="rounded border border-dashed border-gray-200 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Order items</p>
              <ul className="mt-2 grid gap-1 text-sm text-gray-700">
                {order.items.map((item, index) => (
                  <li key={(item?.id as string) || `${order.id}-item-${index}`} className="flex flex-col">
                    <span className="font-medium text-gray-900">{(item?.name as string) || "Line item"}</span>
                    <span className="text-xs text-gray-500">
                      {(item?.id as string) || "Unknown ID"}
                      {item?.quantity ? ` · ×${item.quantity}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DriveAssetStager initialProjectId={projectIdParam || null} initialOrderId={orderIdParam || null} />
      </div>
    </PortalContainer>
  );
}
