'use client';

import { useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  TRAINING_AUDIENCE_OPTIONS,
  type TrainingAudience,
  type TrainingContentBlock,
  type TrainingModuleDraft,
} from '@/lib/training';

export type TrainingContentBlockInput = TrainingContentBlock;

export interface TrainingModuleFormValues extends TrainingModuleDraft {}

interface TrainingModuleFormProps {
  initialValues?: Partial<TrainingModuleFormValues>;
  onSubmit: (values: TrainingModuleFormValues) => Promise<void> | void;
  onCancel?: () => void;
  submitting?: boolean;
  submitLabel?: string;
  allowCancel?: boolean;
}

const defaultTextBlock = (): TrainingContentBlockInput => ({
  id: createBlockId(),
  type: 'text',
  title: 'Overview',
  body: '',
});

const defaultVideoBlock = (): TrainingContentBlockInput => ({
  id: createBlockId(),
  type: 'video',
  title: 'Training video',
  url: '',
  description: '',
});

const defaultImageBlock = (): TrainingContentBlockInput => ({
  id: createBlockId(),
  type: 'image',
  title: 'Visual reference',
  url: '',
  caption: '',
});

const defaultLinkBlock = (): TrainingContentBlockInput => ({
  id: createBlockId(),
  type: 'link',
  title: 'Resource link',
  url: '',
  description: '',
});

function createBlockId() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
      return `block-${globalThis.crypto.randomUUID()}`;
    }
  } catch (error) {
    // ignore – fallback to Math.random
  }
  return `block-${Math.random().toString(36).slice(2, 10)}`;
}

function getDefaultBlocks(initialBlocks?: TrainingContentBlockInput[]): TrainingContentBlockInput[] {
  if (initialBlocks && initialBlocks.length > 0) {
    return initialBlocks.map((block) => ({ ...block }));
  }
  return [defaultTextBlock()];
}

export default function TrainingModuleForm({
  initialValues,
  onSubmit,
  onCancel,
  submitting = false,
  submitLabel = 'Save module',
  allowCancel = true,
}: TrainingModuleFormProps) {
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [summary, setSummary] = useState(initialValues?.summary ?? '');
  const [category, setCategory] = useState(initialValues?.category ?? '');
  const [keywordsInput, setKeywordsInput] = useState(
    initialValues?.keywords?.length ? initialValues.keywords.join(', ') : ''
  );
  const [audiences, setAudiences] = useState<TrainingAudience[]>(
    initialValues?.audiences?.length ? [...initialValues.audiences] : ['franchisees', 'teamMembers']
  );
  const [heroImageUrl, setHeroImageUrl] = useState(initialValues?.heroImageUrl ?? '');
  const [estimatedDuration, setEstimatedDuration] = useState(initialValues?.estimatedDuration ?? '');
  const [contentBlocks, setContentBlocks] = useState<TrainingContentBlockInput[]>(
    getDefaultBlocks(initialValues?.content as TrainingContentBlockInput[] | undefined)
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const keywordList = useMemo(
    () =>
      keywordsInput
        .split(',')
        .map((keyword) => keyword.trim())
        .filter(Boolean),
    [keywordsInput]
  );

  const handleAudienceToggle = (audience: TrainingAudience) => {
    setAudiences((prev) => {
      if (prev.includes(audience)) {
        return prev.filter((item) => item !== audience);
      }
      return [...prev, audience];
    });
  };

  const updateBlock = useCallback(
    (blockId: string, updates: Partial<TrainingContentBlockInput>) => {
      setContentBlocks((prev) =>
        prev.map((block) => (block.id === blockId ? { ...block, ...updates } : block))
      );
    },
    []
  );

  const removeBlock = (blockId: string) => {
    setContentBlocks((prev) => prev.filter((block) => block.id !== blockId));
  };

  const moveBlock = (blockId: string, direction: -1 | 1) => {
    setContentBlocks((prev) => {
      const index = prev.findIndex((block) => block.id === blockId);
      if (index === -1) return prev;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const [block] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, block);
      return copy;
    });
  };

  const addBlock = (type: TrainingContentBlockInput['type']) => {
    setContentBlocks((prev) => {
      const next = [...prev];
      switch (type) {
        case 'video':
          next.push(defaultVideoBlock());
          break;
        case 'image':
          next.push(defaultImageBlock());
          break;
        case 'link':
          next.push(defaultLinkBlock());
          break;
        case 'text':
        default:
          next.push(defaultTextBlock());
      }
      return next;
    });
  };

  const sanitizeBlocks = (): TrainingContentBlockInput[] => {
    return contentBlocks
      .map((block) => {
        switch (block.type) {
          case 'text':
            return {
              ...block,
              body: (block as any).body ?? '',
              title: block.title ?? '',
            };
          case 'video':
            return {
              ...block,
              url: block.url?.trim() ?? '',
              title: block.title ?? '',
              description: block.description ?? '',
            };
          case 'image':
            return {
              ...block,
              url: block.url?.trim() ?? '',
              title: block.title ?? '',
              caption: block.caption ?? '',
            };
          case 'link':
            return {
              ...block,
              title: block.title ?? '',
              url: block.url?.trim() ?? '',
              description: block.description ?? '',
            };
          default:
            return block;
        }
      })
      .filter((block) => {
        if (block.type === 'text') {
          return Boolean((block.body ?? '').trim() || (block.title ?? '').trim());
        }
        if (block.type === 'video' || block.type === 'image' || block.type === 'link') {
          return Boolean(block.url?.trim());
        }
        return true;
      });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (!title.trim()) {
      setFormError('Please provide a title for the module.');
      return;
    }

    if (!summary.trim()) {
      setFormError('Please add a short summary to explain what this module covers.');
      return;
    }

    if (audiences.length === 0) {
      setFormError('Select at least one audience that should see this module.');
      return;
    }

    const cleanedBlocks = sanitizeBlocks();
    if (cleanedBlocks.length === 0) {
      setFormError('Add at least one content block before saving.');
      return;
    }

    const values: TrainingModuleFormValues = {
      title: title.trim(),
      summary: summary.trim(),
      category: category.trim() || undefined,
      keywords: keywordList,
      audiences,
      heroImageUrl: heroImageUrl.trim() || undefined,
      estimatedDuration: estimatedDuration.trim() || undefined,
      content: cleanedBlocks,
      resources: initialValues?.resources ?? [],
    };

    try {
      await onSubmit(values);
      setSuccessMessage('Training module saved successfully.');
    } catch (error) {
      console.error('Failed to submit training module form', error);
      setFormError('Something went wrong while saving. Please try again.');
    }
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <section className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-700">Title</span>
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Welcome to Pineapple Tapped"
              required
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-700">Category</span>
            <input
              className="input"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Onboarding"
            />
          </label>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">Summary</span>
          <textarea
            className="textarea"
            rows={4}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Everything new franchisees need to know about using the Pineapple Tapped portal."
            required
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-700">Keywords</span>
            <input
              className="input"
              value={keywordsInput}
              onChange={(event) => setKeywordsInput(event.target.value)}
              placeholder="portal, onboarding, project management"
            />
            <span className="text-xs text-slate-500">
              Separate each keyword with a comma to help users search by topic.
            </span>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-slate-700">Estimated duration</span>
            <input
              className="input"
              value={estimatedDuration}
              onChange={(event) => setEstimatedDuration(event.target.value)}
              placeholder="15 minutes"
            />
          </label>
        </div>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">Hero image URL</span>
          <input
            className="input"
            value={heroImageUrl}
            onChange={(event) => setHeroImageUrl(event.target.value)}
            placeholder="https://..."
          />
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Audience</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {TRAINING_AUDIENCE_OPTIONS.map((option) => {
            const checked = audiences.includes(option.key);
            return (
              <label
                key={option.key}
                className={clsx(
                  'flex cursor-pointer flex-col gap-2 rounded-2xl border p-4 transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2',
                  checked
                    ? 'border-orange-500 bg-orange-50 focus-within:outline-orange-500'
                    : 'border-slate-200 bg-white hover:border-slate-300 focus-within:outline-slate-300'
                )}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={checked}
                    onChange={() => handleAudienceToggle(option.key)}
                  />
                  <span className="text-sm font-semibold text-slate-800">{option.label}</span>
                </div>
                <p className="text-xs text-slate-600">{option.description}</p>
              </label>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Content blocks</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => addBlock('text')}
            >
              Add text
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => addBlock('video')}
            >
              Add video
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => addBlock('image')}
            >
              Add image
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => addBlock('link')}
            >
              Add resource link
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {contentBlocks.map((block, index) => (
            <article key={block.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    Block {index + 1} · {block.type}
                  </p>
                  <h3 className="text-base font-semibold text-slate-800">
                    {block.title?.trim() || 'Untitled block'}
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-xs"
                    onClick={() => moveBlock(block.id, -1)}
                    disabled={index === 0}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs"
                    onClick={() => moveBlock(block.id, 1)}
                    disabled={index === contentBlocks.length - 1}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-error"
                    onClick={() => removeBlock(block.id)}
                    disabled={contentBlocks.length === 1}
                  >
                    Remove
                  </button>
                </div>
              </header>

              <div className="mt-4 space-y-3">
                {(block.type === 'text' || block.type === 'video' || block.type === 'image' || block.type === 'link') && (
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-slate-700">Heading</span>
                    <input
                      className="input"
                      value={block.title ?? ''}
                      onChange={(event) => updateBlock(block.id, { title: event.target.value })}
                      placeholder="Block title"
                    />
                  </label>
                )}

                {block.type === 'text' && (
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-slate-700">Body copy</span>
                    <textarea
                      className="textarea"
                      rows={6}
                      value={(block as any).body ?? ''}
                      onChange={(event) => updateBlock(block.id, { body: event.target.value })}
                      placeholder="Share detailed guidance, bullet points, or checklists."
                    />
                  </label>
                )}

                {block.type === 'video' && (
                  <>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-slate-700">Video URL</span>
                      <input
                        className="input"
                        value={block.url ?? ''}
                        onChange={(event) => updateBlock(block.id, { url: event.target.value })}
                        placeholder="https://www.youtube.com/..."
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-slate-700">Description</span>
                      <textarea
                        className="textarea"
                        rows={3}
                        value={block.description ?? ''}
                        onChange={(event) => updateBlock(block.id, { description: event.target.value })}
                        placeholder="What should the viewer learn from this video?"
                      />
                    </label>
                  </>
                )}

                {block.type === 'image' && (
                  <>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-slate-700">Image URL</span>
                      <input
                        className="input"
                        value={block.url ?? ''}
                        onChange={(event) => updateBlock(block.id, { url: event.target.value })}
                        placeholder="https://.../asset.png"
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-slate-700">Caption</span>
                      <input
                        className="input"
                        value={block.caption ?? ''}
                        onChange={(event) => updateBlock(block.id, { caption: event.target.value })}
                        placeholder="Explain what the image highlights."
                      />
                    </label>
                  </>
                )}

                {block.type === 'link' && (
                  <>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-slate-700">URL</span>
                      <input
                        className="input"
                        value={block.url ?? ''}
                        onChange={(event) => updateBlock(block.id, { url: event.target.value })}
                        placeholder="https://"
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium text-slate-700">Description</span>
                      <textarea
                        className="textarea"
                        rows={3}
                        value={block.description ?? ''}
                        onChange={(event) => updateBlock(block.id, { description: event.target.value })}
                        placeholder="Why should learners review this resource?"
                      />
                    </label>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {formError && (
        <div className="alert alert-error">
          <span>{formError}</span>
        </div>
      )}

      {successMessage && (
        <div className="alert alert-success">
          <span>{successMessage}</span>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-end gap-3">
        {allowCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? 'Saving…' : submitLabel}
        </button>
      </footer>
    </form>
  );
}
