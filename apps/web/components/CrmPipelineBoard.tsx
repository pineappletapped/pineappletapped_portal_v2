"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import {
  CRM_PIPELINE_STATUSES,
  CRM_STATUS_LABELS,
  normaliseCrmStatus,
  extractProspectAmounts,
} from "@/lib/crm";
import { coerceDate, formatDateTime } from "@/lib/datetime";

export interface CrmPipelineRecord extends Record<string, any> {
  id: string;
  crmStatus?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  organisation?: string | null;
  notes?: string | null;
  suggestedProductId?: string | null;
  suggestedProductName?: string | null;
  updatedAt?: unknown;
  lastContactedAt?: unknown;
  createdAt?: unknown;
}

interface CrmPipelineBoardProps<TRecord extends CrmPipelineRecord> {
  records: TRecord[];
  loading?: boolean;
  readOnly?: boolean;
  formatCurrency: (value: number) => string;
  onStatusChange?: (record: TRecord, status: typeof CRM_PIPELINE_STATUSES[number]) => void | Promise<void>;
  getSuggestedProductName?: (record: TRecord) => string | null;
  getViewHref?: (record: TRecord) => string | null;
  renderActions?: (record: TRecord) => ReactNode;
  emptyMessage?: string;
}

export default function CrmPipelineBoard<TRecord extends CrmPipelineRecord>(
  props: CrmPipelineBoardProps<TRecord>
) {
  const {
    records,
    loading = false,
    readOnly = false,
    formatCurrency,
    onStatusChange,
    getSuggestedProductName,
    getViewHref,
    renderActions,
    emptyMessage = "No records in this stage.",
  } = props;

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [hoveredStatus, setHoveredStatus] = useState<string | null>(null);

  const recordById = useMemo(() => {
    const map = new Map<string, TRecord>();
    records.forEach((record) => {
      if (record?.id) {
        map.set(record.id, record);
      }
    });
    return map;
  }, [records]);

  const grouped = useMemo(() => {
    const map = new Map<string, TRecord[]>();
    CRM_PIPELINE_STATUSES.forEach((status) => map.set(status, []));

    records.forEach((record) => {
      const status = normaliseCrmStatus(record.crmStatus);
      if (!CRM_PIPELINE_STATUSES.includes(status)) {
        return;
      }
      map.get(status)!.push(record);
    });

    CRM_PIPELINE_STATUSES.forEach((status) => {
      const entries = map.get(status);
      if (!entries) return;
      entries.sort((a, b) => {
        const aTime =
          coerceDate(a.updatedAt)?.getTime() ||
          coerceDate(a.lastContactedAt)?.getTime() ||
          coerceDate(a.createdAt)?.getTime() ||
          0;
        const bTime =
          coerceDate(b.updatedAt)?.getTime() ||
          coerceDate(b.lastContactedAt)?.getTime() ||
          coerceDate(b.createdAt)?.getTime() ||
          0;
        return bTime - aTime;
      });
    });

    return map;
  }, [records]);

  const canInteract = !readOnly && typeof onStatusChange === "function";

  if (loading) {
    return <p className="text-sm text-gray-600">Loading pipeline…</p>;
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {CRM_PIPELINE_STATUSES.map((status) => {
        const entries = grouped.get(status) ?? [];
        const isHovered = hoveredStatus === status;
        return (
          <section
            key={status}
            className={`flex w-72 min-w-[18rem] flex-col gap-3 rounded border border-gray-200 bg-white p-3 shadow-sm transition ${
              isHovered ? "border-orange-400 bg-orange-50/60 ring-2 ring-orange-200" : ""
            }`}
            onDragEnter={(event) => {
              if (!canInteract) return;
              event.preventDefault();
              setHoveredStatus(status);
            }}
            onDragOver={(event) => {
              if (!canInteract) return;
              event.preventDefault();
              if (hoveredStatus !== status) {
                setHoveredStatus(status);
              }
            }}
            onDragLeave={() => {
              if (!canInteract) return;
              setHoveredStatus((current) => (current === status ? null : current));
            }}
            onDrop={(event) => {
              if (!canInteract) return;
              event.preventDefault();
              const droppedId = event.dataTransfer.getData("text/plain") || draggedId;
              setHoveredStatus(null);
              setDraggedId(null);
              if (!droppedId) {
                return;
              }
              const droppedRecord = recordById.get(droppedId);
              if (!droppedRecord) {
                return;
              }
              const currentStatus = normaliseCrmStatus(droppedRecord.crmStatus);
              if (currentStatus === status) {
                return;
              }
              void onStatusChange?.(droppedRecord, status);
            }}
          >
            <header className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">{CRM_STATUS_LABELS[status]}</h3>
              <span className="text-xs text-gray-500">{entries.length}</span>
            </header>
            <div className="grid gap-3">
              {entries.length === 0 ? (
                <p className="text-xs text-gray-500">{emptyMessage}</p>
              ) : (
                entries.map((record) => {
                  const organisation =
                    typeof record.organisation === "string" && record.organisation.trim().length
                      ? record.organisation.trim()
                      : null;
                  const contactName =
                    (typeof record.fullName === "string" && record.fullName.trim()) ||
                    organisation ||
                    (typeof record.email === "string" && record.email.trim()) ||
                    "Prospect";
                  const { pipeline, quoted } = extractProspectAmounts(record);
                  const suggestedProduct =
                    getSuggestedProductName?.(record) ??
                    (typeof record.suggestedProductName === "string" && record.suggestedProductName.trim()
                      ? record.suggestedProductName.trim()
                      : typeof record.suggestedProduct === "string" && record.suggestedProduct.trim()
                      ? record.suggestedProduct.trim()
                      : null);
                  const viewHref = getViewHref?.(record) ?? null;
                  const lastUpdated = formatDateTime(
                    record.updatedAt || record.lastContactedAt || record.createdAt
                  );

                  return (
                    <article
                      key={record.id}
                      draggable={canInteract}
                      onDragStart={(event) => {
                        if (!canInteract) return;
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", record.id);
                        setDraggedId(record.id);
                      }}
                      onDragEnd={() => {
                        if (!canInteract) return;
                        setDraggedId((current) => (current === record.id ? null : current));
                        setHoveredStatus(null);
                      }}
                      className={`flex flex-col gap-2 rounded border p-3 text-sm shadow-sm transition ${
                        canInteract && draggedId === record.id
                          ? "border-orange-400 bg-orange-50"
                          : "border-gray-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-gray-900">{contactName}</p>
                          <div className="mt-1 grid gap-0.5 text-xs text-gray-600">
                            {organisation ? <span>{organisation}</span> : null}
                            {record.email ? <span>{record.email}</span> : null}
                            {record.phone ? <span>{record.phone}</span> : null}
                          </div>
                        </div>
                        {renderActions ? (
                          renderActions(record)
                        ) : viewHref ? (
                          <Link className="btn-sm" href={viewHref}>
                            View
                          </Link>
                        ) : null}
                      </div>
                      {(pipeline || quoted) && (
                        <div className="flex flex-wrap gap-2 text-xs">
                          {pipeline ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                              Value: {formatCurrency(pipeline)}
                            </span>
                          ) : null}
                          {quoted ? (
                            <span className="rounded-full bg-sky-50 px-2 py-1 font-medium text-sky-700">
                              Quoted: {formatCurrency(quoted)}
                            </span>
                          ) : null}
                        </div>
                      )}
                      {suggestedProduct ? (
                        <p className="text-xs text-gray-600">Suggested: {suggestedProduct}</p>
                      ) : null}
                      {typeof record.notes === "string" && record.notes.trim().length ? (
                        <p className="max-h-24 overflow-hidden whitespace-pre-line text-xs text-gray-600">
                          {record.notes.trim()}
                        </p>
                      ) : null}
                      <p className="text-[11px] text-gray-500">Last update: {lastUpdated}</p>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
