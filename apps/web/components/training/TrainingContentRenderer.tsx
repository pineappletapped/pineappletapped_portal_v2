import Link from 'next/link';
import clsx from 'clsx';
import {
  type TrainingContentBlock,
  type TrainingModuleRecord,
  formatTrainingAudienceList,
  isTrainingModuleNew,
  timestampToDate,
} from '@/lib/training';

interface TrainingContentRendererProps {
  module: TrainingModuleRecord;
}

const isEmbeddableVideo = (url: string): boolean => {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return /youtube\.com|youtu\.be|vimeo\.com|loom\.com/.test(parsed.hostname);
  } catch (error) {
    return false;
  }
};

const buildEmbedUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      const videoId = parsed.pathname.replace('/', '');
      return `https://www.youtube.com/embed/${videoId}`;
    }
    if (parsed.hostname.includes('youtube.com')) {
      const videoId = parsed.searchParams.get('v');
      if (videoId) {
        return `https://www.youtube.com/embed/${videoId}`;
      }
      if (parsed.pathname.startsWith('/embed/')) {
        return url;
      }
    }
    if (parsed.hostname.includes('vimeo.com')) {
      const videoId = parsed.pathname.replace('/', '');
      return `https://player.vimeo.com/video/${videoId}`;
    }
    if (parsed.hostname.includes('loom.com')) {
      return url.replace('/share/', '/embed/');
    }
  } catch (error) {
    // noop – fallback to original URL
  }
  return url;
};

const renderBlock = (block: TrainingContentBlock, index: number) => {
  switch (block.type) {
    case 'text':
      return (
        <section key={block.id} className="space-y-3">
          {block.title && <h3 className="text-xl font-semibold text-slate-800">{block.title}</h3>}
          <p className="whitespace-pre-wrap text-slate-700 leading-relaxed">{block.body}</p>
        </section>
      );
    case 'video':
      return (
        <section key={block.id} className="space-y-3">
          {block.title && <h3 className="text-xl font-semibold text-slate-800">{block.title}</h3>}
          {block.description && <p className="text-sm text-slate-600">{block.description}</p>}
          {block.url && isEmbeddableVideo(block.url) ? (
            <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black shadow">
              <iframe
                src={buildEmbedUrl(block.url)}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                title={block.title || `Video ${index + 1}`}
              />
            </div>
          ) : (
            <Link
              href={block.url || '#'}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-orange-600 hover:text-orange-700"
            >
              Watch video
            </Link>
          )}
        </section>
      );
    case 'image':
      return (
        <section key={block.id} className="space-y-3">
          {block.title && <h3 className="text-xl font-semibold text-slate-800">{block.title}</h3>}
          {block.url && (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={block.url} alt={block.title || block.caption || 'Training illustration'} className="w-full" />
            </div>
          )}
          {block.caption && <p className="text-sm text-slate-600">{block.caption}</p>}
        </section>
      );
    case 'link':
      return (
        <section key={block.id} className="space-y-3">
          <h3 className="text-xl font-semibold text-slate-800">{block.title}</h3>
          {block.description && <p className="text-sm text-slate-600">{block.description}</p>}
          <Link
            href={block.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-orange-600 hover:text-orange-700"
          >
            Open resource
          </Link>
        </section>
      );
    default:
      return null;
  }
};

export default function TrainingContentRenderer({ module }: TrainingContentRendererProps) {
  const published = timestampToDate(module.publishedAt ?? module.createdAt ?? module.updatedAt);
  const isNew = isTrainingModuleNew(module);
  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-orange-500">Training module</p>
            <h1 className="text-3xl font-semibold text-slate-900">{module.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isNew && <span className="badge badge-success">New</span>}
            <span className="badge badge-outline">{formatTrainingAudienceList(module.audiences)}</span>
          </div>
        </div>
        <p className="text-base text-slate-700">{module.summary}</p>
        <dl className="flex flex-wrap gap-4 text-xs text-slate-500">
          {module.category && (
            <div>
              <dt className="uppercase tracking-wide text-slate-400">Category</dt>
              <dd className="mt-1 text-sm text-slate-700">{module.category}</dd>
            </div>
          )}
          {module.estimatedDuration && (
            <div>
              <dt className="uppercase tracking-wide text-slate-400">Duration</dt>
              <dd className="mt-1 text-sm text-slate-700">{module.estimatedDuration}</dd>
            </div>
          )}
          {published && (
            <div>
              <dt className="uppercase tracking-wide text-slate-400">Published</dt>
              <dd className="mt-1 text-sm text-slate-700">{published.toLocaleDateString()}</dd>
            </div>
          )}
        </dl>
        {module.keywords.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {module.keywords.map((keyword) => (
              <span
                key={keyword}
                className="badge badge-outline border-orange-300 bg-orange-50 text-orange-700"
              >
                #{keyword}
              </span>
            ))}
          </div>
        )}
        {module.heroImageUrl && (
          <div className="overflow-hidden rounded-3xl border border-slate-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={module.heroImageUrl} alt="Training hero" className="w-full" />
          </div>
        )}
      </header>

      <div className="space-y-8">
        {module.content.map((block, index) => (
          <div key={block.id || `${block.type}-${index}`} className={clsx('space-y-3')}>
            {renderBlock(block, index)}
          </div>
        ))}
      </div>

      {module.resources && module.resources.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-slate-900">Additional resources</h2>
          <ul className="space-y-2">
            {module.resources.map((resource) => (
              <li key={resource.id}>
                <Link
                  href={resource.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-orange-600 hover:text-orange-700"
                >
                  {resource.title}
                </Link>
                {resource.description && (
                  <p className="text-xs text-slate-500">{resource.description}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
