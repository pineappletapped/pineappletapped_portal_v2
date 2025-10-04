"use client";

import Link from "next/link";

import {
  AI_WORKFLOWS,
  AiWorkflowPromptRef,
  AiWorkflowSummary,
  AiWorkflowStatus,
} from "./aiWorkflows";

const STATUS_META: Record<AiWorkflowStatus, { label: string; badgeClass: string }> = {
  live: { label: "Live", badgeClass: "bg-emerald-100 text-emerald-700" },
  planned: { label: "Planned", badgeClass: "bg-amber-100 text-amber-700" },
  draft: { label: "Draft", badgeClass: "bg-slate-200 text-slate-600" },
};

const KIND_LABEL: Record<AiWorkflowSummary["kind"], string> = {
  "firestore-trigger": "Firestore trigger",
  callable: "Callable",
  background: "Background helper",
};

function PromptList({ prompts }: { prompts: AiWorkflowPromptRef[] }) {
  if (!prompts.length) {
    return <p className="text-sm text-gray-500">No prompt references recorded yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {prompts.map((prompt) => {
        const status = STATUS_META[prompt.status];
        return (
          <li key={prompt.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-medium text-gray-900">{prompt.label}</div>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${status.badgeClass}`}
              >
                {status.label}
              </span>
            </div>
            {prompt.commandName ? (
              <p className="mt-1 text-xs text-gray-600">
                Command log key: <code className="rounded bg-slate-100 px-1.5 py-0.5">{prompt.commandName}</code>
              </p>
            ) : null}
            {prompt.promptDocHint ? (
              <p className="mt-1 text-xs text-gray-600">
                Prompt reference: <code className="rounded bg-slate-100 px-1.5 py-0.5">{prompt.promptDocHint}</code>
              </p>
            ) : null}
            {prompt.notes ? (
              <p className="mt-2 text-sm text-gray-600">{prompt.notes}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function WorkflowCard({ workflow }: { workflow: AiWorkflowSummary }) {
  const status = STATUS_META[workflow.status];
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900">{workflow.title}</h3>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${status.badgeClass}`}
            >
              {status.label}
            </span>
          </div>
          <div className="text-sm text-gray-600">{workflow.description}</div>
        </div>
        <span className="inline-flex h-9 items-center rounded-full bg-slate-100 px-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
          {KIND_LABEL[workflow.kind]}
        </span>
      </div>

      <dl className="mt-4 space-y-4 text-sm text-gray-700">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Function</dt>
          <dd className="font-mono text-[13px] text-gray-900">
            {workflow.functionName} <span className="text-slate-400">({workflow.entryPoint})</span>
          </dd>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Code location</dt>
          <dd className="font-mono text-[13px] text-gray-900">
            {workflow.codeLocation.path}
            {workflow.codeLocation.anchor ? ` · ${workflow.codeLocation.anchor}` : ""}
          </dd>
        </div>
        {workflow.docs && workflow.docs.length > 0 ? (
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documentation</dt>
            <dd className="space-y-1">
              {workflow.docs.map((doc) => {
                const isExternal = /^https?:\/\//i.test(doc.path);
                if (isExternal) {
                  return (
                    <div key={doc.path}>
                      <Link
                        href={doc.path}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-700 underline-offset-4 hover:underline"
                      >
                        {doc.label}
                      </Link>
                    </div>
                  );
                }
                return (
                  <div key={doc.path} className="font-mono text-[13px] text-gray-900">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5">{doc.path}</code> – {doc.label}
                  </div>
                );
              })}
            </dd>
          </div>
        ) : null}
        {workflow.notes ? (
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</dt>
            <dd className="text-sm text-gray-600">{workflow.notes}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-6 space-y-3">
        <h4 className="text-sm font-semibold text-gray-900">Prompt & command references</h4>
        <PromptList prompts={workflow.prompts} />
      </div>
    </article>
  );
}

export default function AiWorkflowCatalog() {
  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-gray-900">AI workflows & callables</h2>
        <p className="text-sm text-gray-600">
          Every automation or callable touching AI is catalogued here so HQ can trace prompts, command names, and documentation
          before rolling out new assistants.
        </p>
      </div>
      <div className="grid gap-4">
        {AI_WORKFLOWS.map((workflow) => (
          <WorkflowCard key={workflow.id} workflow={workflow} />
        ))}
      </div>
    </section>
  );
}
