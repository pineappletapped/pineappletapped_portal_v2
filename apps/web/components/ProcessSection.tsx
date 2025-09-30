'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';

import type { ProcessStage } from '@/lib/homepage';

interface ProcessSectionProps {
  title: string;
  description: string;
  videoUrl: string;
  posterUrl: string;
  stages: ProcessStage[];
}

export default function ProcessSection({
  title,
  description,
  videoUrl,
  posterUrl,
  stages,
}: ProcessSectionProps) {
  const validStages = useMemo(() => {
    if (!Array.isArray(stages)) {
      return [] as ProcessStage[];
    }

    return stages
      .map((stage) => ({
        ...stage,
        title: stage.title.trim(),
        description: stage.description.trim(),
      }))
      .filter((stage) => stage.title.length > 0 && stage.description.length > 0);
  }, [stages]);
  const stageCount = validStages.length;
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabGroupId = useId();

  useEffect(() => {
    if (stageCount === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex(0);
  }, [stageCount]);

  const hasTitle = Boolean(title && title.trim().length > 0);
  const hasDescription = Boolean(description && description.trim().length > 0);
  const hasVideo = Boolean(videoUrl && videoUrl.trim().length > 0);

  if (!hasTitle && !hasDescription && stageCount === 0 && !hasVideo) {
    return null;
  }

  const moveToIndex = (nextIndex: number) => {
    if (stageCount === 0) {
      return;
    }
    const normalized = (nextIndex + stageCount) % stageCount;
    setActiveIndex(normalized);
    const nextTab = tabRefs.current[normalized];
    if (nextTab) {
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => nextTab.focus());
      } else {
        nextTab.focus();
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (stageCount === 0) {
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveToIndex(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveToIndex(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveToIndex(0);
        break;
      case 'End':
        event.preventDefault();
        moveToIndex(stageCount - 1);
        break;
      default:
        break;
    }
  };

  const safeIndex = stageCount > 0 ? Math.min(activeIndex, stageCount - 1) : 0;
  const activeStage = stageCount > 0 ? validStages[safeIndex] : null;
  const tablistLabel = hasTitle ? `${title} stages` : 'Workflow stages';

  return (
    <section className="bg-orange text-white">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <div
          className={clsx(
            'grid gap-12',
            hasVideo ? 'lg:grid-cols-[1.05fr_minmax(0,0.95fr)]' : 'lg:max-w-3xl',
          )}
        >
          <div className="flex flex-col gap-6">
            {(hasTitle || hasDescription) && (
              <div className="space-y-4">
                <p className="text-sm uppercase tracking-[0.2em] text-white">Our process</p>
                {hasTitle && <h2 className="text-3xl font-semibold md:text-4xl">{title}</h2>}
                {hasDescription && <p className="max-w-2xl text-white/90">{description}</p>}
              </div>
            )}

            {stageCount > 0 && activeStage && (
              <div>
                <div role="tablist" aria-label={tablistLabel} className="flex flex-wrap gap-3">
                  {validStages.map((stage, index) => {
                    const isActive = index === activeIndex;
                    return (
                      <button
                        key={stage.id}
                        ref={(el) => {
                          tabRefs.current[index] = el;
                        }}
                        type="button"
                        role="tab"
                        id={`${tabGroupId}-tab-${index}`}
                        aria-controls={`${tabGroupId}-panel-${index}`}
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        className={clsx(
                          'rounded-full border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                          isActive
                            ? 'border-white bg-white text-orange'
                            : 'border-white/80 text-white hover:border-white hover:text-white',
                        )}
                        onClick={() => moveToIndex(index)}
                        onKeyDown={(event) => handleKeyDown(event, index)}
                      >
                        {stage.title}
                      </button>
                    );
                  })}
                </div>

                <div
                  role="tabpanel"
                  id={`${tabGroupId}-panel-${safeIndex}`}
                  aria-labelledby={`${tabGroupId}-tab-${safeIndex}`}
                  className="mt-6 rounded-2xl bg-white/10 p-6 shadow-lg backdrop-blur"
                >
                  <h3 className="text-xl font-semibold md:text-2xl text-white">{activeStage.title}</h3>
                  <p className="mt-2 text-base text-white">{activeStage.description}</p>
                </div>
              </div>
            )}
          </div>

          {hasVideo && (
            <div className="relative overflow-hidden rounded-3xl border border-white/20 bg-black/10 shadow-2xl">
              <div className="aspect-video">
                <video
                  className="h-full w-full object-cover"
                  controls
                  poster={posterUrl?.trim().length ? posterUrl : undefined}
                  preload="metadata"
                  aria-label={hasTitle ? `${title} walkthrough video` : 'Client portal workflow video'}
                >
                  <source src={videoUrl} type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
