"use client";
import Link from 'next/link';

/**
 * CRM home page providing links to leads, groups and opportunities. A starting point for
 * basic CRM operations such as capturing leads, organising them into outreach groups and
 * tracking conversion to orders. Only staff and client_admins should see this section.
 */
export default function CRMHome() {
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">CRM</h1>
      <div className="grid gap-4">
        <Link href="/crm/leads" className="card p-4 hover:bg-gray-50">
          <div className="font-medium">Leads</div>
          <p className="text-sm text-gray-600">Capture potential clients and track their status.</p>
        </Link>
        <Link href="/crm/groups" className="card p-4 hover:bg-gray-50">
          <div className="font-medium">Groups</div>
          <p className="text-sm text-gray-600">Organise contacts into outreach groups for mass email.</p>
        </Link>
        <Link href="/crm/opportunities" className="card p-4 hover:bg-gray-50">
          <div className="font-medium">Opportunities</div>
          <p className="text-sm text-gray-600">Monitor active deals and conversion pipelines.</p>
        </Link>
        <Link href="/crm/proposals" className="card p-4 hover:bg-gray-50">
          <div className="font-medium">Proposals</div>
          <p className="text-sm text-gray-600">Track sent proposals and convert them to projects.</p>
        </Link>
        <Link href="/crm/quotes" className="card p-4 hover:bg-gray-50">
          <div className="font-medium">Quote Requests</div>
          <p className="text-sm text-gray-600">Review custom project quote submissions.</p>
        </Link>
      </div>
    </div>
  );
}