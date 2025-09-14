
import clsx from 'clsx';

export default function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-stage-draft text-white',
    intake: 'bg-stage-intake text-white',
    in_progress: 'bg-stage-in_progress text-white',
    awaiting_approval: 'bg-stage-awaiting_approval text-white',
    revisions: 'bg-stage-revisions text-white',
    delivered: 'bg-stage-delivered text-white',
    archived: 'bg-stage-archived text-white'
  };
  return <span className={clsx('badge', map[status] || 'bg-gray-300 text-gray-900')}>{status.replace('_',' ')}</span>;
}
