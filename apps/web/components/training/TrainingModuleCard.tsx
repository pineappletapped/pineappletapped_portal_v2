import Link from 'next/link';
import {
  formatTrainingAudienceList,
  isTrainingModuleNew,
  timestampToDate,
  type TrainingModuleRecord,
} from '@/lib/training';

interface TrainingModuleCardProps {
  module: TrainingModuleRecord;
  href: string;
  viewed?: boolean;
  lastViewedAt?: Date | null;
}

export default function TrainingModuleCard({
  module,
  href,
  viewed = false,
  lastViewedAt,
}: TrainingModuleCardProps) {
  const updated = timestampToDate(module.updatedAt ?? module.publishedAt ?? module.createdAt);
  const isNew = isTrainingModuleNew(module);

  return (
    <Link
      href={href}
      className="flex h-full flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-orange-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {isNew && <span className="badge badge-success">New</span>}
          <span className="badge badge-outline text-xs">{formatTrainingAudienceList(module.audiences)}</span>
          {viewed && <span className="badge badge-ghost text-xs">Viewed</span>}
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-semibold text-slate-900">{module.title}</h3>
          <p className="text-sm text-slate-600 line-clamp-3">{module.summary}</p>
        </div>
      </div>
      <footer className="mt-4 space-y-2 text-xs text-slate-500">
        {module.category && <p className="font-medium text-slate-600">Category · {module.category}</p>}
        {module.keywords.length > 0 && (
          <p className="truncate">Keywords · {module.keywords.join(', ')}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {updated && <span>Updated {updated.toLocaleDateString()}</span>}
          {lastViewedAt && <span>Last viewed {lastViewedAt.toLocaleDateString()}</span>}
        </div>
      </footer>
    </Link>
  );
}
