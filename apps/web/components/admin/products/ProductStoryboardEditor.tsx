import { useMemo } from "react";
import Image from "next/image";

export const STORYBOARD_SCENE_COLOURS = [
  "#f97316",
  "#0ea5e9",
  "#8b5cf6",
  "#10b981",
  "#ec4899",
  "#facc15",
  "#38bdf8",
  "#14b8a6",
];

const TIME_PATTERN = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*$/;
const SHORT_TIME_PATTERN = /^\s*(\d{1,2}):(\d{2})\s*$/;

export const parseStoryboardTimecode = (value: string): number | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  const longMatch = trimmed.match(TIME_PATTERN);
  if (longMatch) {
    hours = Number(longMatch[1] ?? "0");
    minutes = Number(longMatch[2] ?? "0");
    seconds = Number(longMatch[3] ?? "0");
  } else {
    const shortMatch = trimmed.match(SHORT_TIME_PATTERN);
    if (!shortMatch) {
      const fallback = Number(trimmed);
      return Number.isFinite(fallback) && fallback >= 0 ? fallback : null;
    }
    minutes = Number(shortMatch[1] ?? "0");
    seconds = Number(shortMatch[2] ?? "0");
  }
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    minutes > 59 ||
    seconds > 59 ||
    hours < 0 ||
    minutes < 0 ||
    seconds < 0
  ) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
};

export const formatStoryboardSeconds = (seconds: number | null | undefined): string => {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return "";
  }
  const rounded = Math.round(seconds);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

export type StoryboardSceneFormState = {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  variationIds: string[];
  imageUrl: string | null;
  previewUrl: string | null;
  imageFile?: File | null;
  imageStoragePath: string | null;
  persistedImage: boolean;
  aiStatus: "idle" | "loading" | "error";
  aiError: string | null;
};

type VariationOption = { id: string; name: string };

type ProductStoryboardEditorProps = {
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  scenes: StoryboardSceneFormState[];
  onSceneChange: (sceneId: string, patch: Partial<StoryboardSceneFormState>) => void;
  onSceneImageSelect: (sceneId: string, file: File | null) => void;
  onAddScene: () => void;
  onRemoveScene: (sceneId: string) => void;
  onGenerateSceneImage: (sceneId: string) => void;
  generatingSceneId: string | null;
  variationOptions: VariationOption[];
};

type TimelineSegment = {
  id: string;
  label: string;
  startLabel: string;
  endLabel: string;
  durationLabel: string;
  width: number;
  color: string;
  image: string | null;
};

const buildDurationLabel = (startSeconds: number | null, endSeconds: number | null): string => {
  if (startSeconds === null && endSeconds === null) return "Timing TBD";
  if (startSeconds === null) return `0:00 – ${formatStoryboardSeconds(endSeconds)}`;
  if (endSeconds === null) return `${formatStoryboardSeconds(startSeconds)} onwards`;
  if (endSeconds <= startSeconds) {
    return `${formatStoryboardSeconds(startSeconds)} – ${formatStoryboardSeconds(endSeconds)}`;
  }
  return `${formatStoryboardSeconds(startSeconds)} – ${formatStoryboardSeconds(endSeconds)}`;
};

const ProductStoryboardEditor = ({
  enabled,
  onToggleEnabled,
  scenes,
  onSceneChange,
  onSceneImageSelect,
  onAddScene,
  onRemoveScene,
  onGenerateSceneImage,
  generatingSceneId,
  variationOptions,
}: ProductStoryboardEditorProps) => {
  const timeline = useMemo(() => {
    if (!enabled || scenes.length === 0) return [] as TimelineSegment[];
    const segments = scenes.map((scene, index) => {
      const startSeconds = parseStoryboardTimecode(scene.start);
      const endSeconds = parseStoryboardTimecode(scene.end);
      let duration = 0;
      if (
        typeof startSeconds === "number" &&
        typeof endSeconds === "number" &&
        endSeconds > startSeconds
      ) {
        duration = endSeconds - startSeconds;
      } else if (typeof endSeconds === "number") {
        duration = Math.max(endSeconds, 30);
      } else if (typeof startSeconds === "number") {
        duration = Math.max(60 - startSeconds, 30);
      } else {
        duration = 60;
      }
      return {
        id: scene.id,
        duration,
        color: STORYBOARD_SCENE_COLOURS[index % STORYBOARD_SCENE_COLOURS.length],
        label: scene.title.trim() || `Scene ${index + 1}`,
        startLabel:
          typeof startSeconds === "number"
            ? formatStoryboardSeconds(startSeconds)
            : "0:00",
        endLabel:
          typeof endSeconds === "number"
            ? formatStoryboardSeconds(endSeconds)
            : "…",
        durationLabel: buildDurationLabel(startSeconds, endSeconds),
        image: scene.previewUrl || scene.imageUrl || null,
      } satisfies Omit<TimelineSegment, "width"> & { duration: number };
    });
    const total = segments.reduce((sum, item) => sum + item.duration, 0) || 1;
    return segments.map((segment) => ({
      ...segment,
      width: Math.max(10, Math.round((segment.duration / total) * 100)),
    }));
  }, [enabled, scenes]);

  return (
    <section className="grid gap-6">
      <header className="grid gap-2">
        <h2 className="text-lg font-semibold">Storyboard</h2>
        <p className="text-sm text-gray-600">
          Share a visual timeline of the shoot. Scenes appear on the product page when
          the storyboard is enabled, helping customers picture the flow before they
          book.
        </p>
        <label className="flex w-fit items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300"
            checked={enabled}
            onChange={(event) => onToggleEnabled(event.target.checked)}
          />
          Show storyboard on product detail page
        </label>
      </header>

      {enabled ? (
        <>
          <div className="grid gap-4 rounded border border-dashed border-slate-300 bg-white p-4">
            {timeline.length === 0 ? (
              <p className="text-sm text-gray-500">
                Add scenes with start and end times to preview the timeline layout.
              </p>
            ) : (
              <div className="grid gap-6">
                <div className="grid gap-2">
                  <div className="flex h-4 overflow-hidden rounded">
                    {timeline.map((segment) => (
                      <div
                        key={segment.id}
                        style={{ width: `${segment.width}%`, backgroundColor: segment.color }}
                        className="h-full"
                        title={`${segment.label} (${segment.durationLabel})`}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                    {timeline.map((segment) => (
                      <span key={segment.id} className="flex items-center gap-1">
                        <span
                          className="inline-block h-3 w-3 rounded"
                          style={{ backgroundColor: segment.color }}
                          aria-hidden
                        />
                        {segment.label}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {timeline.map((segment) => (
                    <div
                      key={segment.id}
                      className="grid gap-2 rounded border bg-slate-50 p-3 text-sm"
                    >
                      <p className="font-medium text-gray-900">{segment.label}</p>
                      <p className="text-xs uppercase tracking-wide text-gray-500">
                        {segment.durationLabel}
                      </p>
                      {segment.image ? (
                        <div className="relative h-40 w-full overflow-hidden rounded">
                          <Image
                            src={segment.image}
                            alt={`${segment.label} artwork`}
                            fill
                            sizes="(min-width: 768px) 50vw, 100vw"
                            className="object-cover"
                          />
                        </div>
                      ) : (
                        <div
                          className="grid h-40 place-items-center rounded bg-white text-xs text-gray-400"
                          style={{ border: `1px dashed ${segment.color}` }}
                        >
                          Scene artwork
                        </div>
                      )}
                      <p className="text-xs text-gray-600">{segment.durationLabel}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Scenes</h3>
              <p className="text-sm text-gray-600">
                Document the sequence, timings, and visuals your crew will capture.
              </p>
            </div>
            <button type="button" className="btn btn-sm" onClick={onAddScene}>
              Add scene
            </button>
          </div>

          {scenes.length === 0 ? (
            <p className="rounded border border-dashed border-slate-300 bg-white p-4 text-sm text-gray-500">
              No scenes yet. Add the key beats customers can expect from this production.
            </p>
          ) : (
            <div className="grid gap-6">
              {scenes.map((scene, index) => {
                const variationChips = scene.variationIds
                  .map((id) => variationOptions.find((option) => option.id === id))
                  .filter((option): option is VariationOption => Boolean(option));
                const preview = scene.previewUrl || scene.imageUrl;
                const generating = generatingSceneId === scene.id || scene.aiStatus === "loading";
                return (
                  <article key={scene.id} className="grid gap-4 rounded border bg-white p-4">
                    <header className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-700">
                          Scene {index + 1}
                        </p>
                        {variationChips.length > 0 ? (
                          <p className="text-xs text-gray-500">
                            Variations: {variationChips.map((chip) => chip.name).join(", ")}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-rose-600"
                        onClick={() => onRemoveScene(scene.id)}
                      >
                        Remove
                      </button>
                    </header>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="grid gap-1 text-sm">
                        <span className="font-medium text-gray-700">Scene title</span>
                        <input
                          className="input"
                          value={scene.title}
                          onChange={(event) =>
                            onSceneChange(scene.id, { title: event.target.value })
                          }
                          placeholder="Opening titles"
                        />
                      </label>
                      <div className="grid gap-1 text-sm">
                        <span className="font-medium text-gray-700">Timing</span>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            className="input"
                            value={scene.start}
                            onChange={(event) =>
                              onSceneChange(scene.id, { start: event.target.value })
                            }
                            placeholder="00:00"
                          />
                          <input
                            className="input"
                            value={scene.end}
                            onChange={(event) =>
                              onSceneChange(scene.id, { end: event.target.value })
                            }
                            placeholder="00:45"
                          />
                        </div>
                        <p className="text-xs text-gray-500">
                          Use mm:ss or hh:mm:ss to map the segment on the timeline.
                        </p>
                      </div>
                    </div>

                    <label className="grid gap-1 text-sm">
                      <span className="font-medium text-gray-700">Scene description</span>
                      <textarea
                        className="input min-h-[100px]"
                        value={scene.description}
                        onChange={(event) =>
                          onSceneChange(scene.id, { description: event.target.value })
                        }
                        placeholder="Walkthrough, key shots, and emotions to capture."
                      />
                    </label>

                    {variationOptions.length > 0 ? (
                      <div className="grid gap-2 text-sm">
                        <span className="font-medium text-gray-700">
                          Show for variations
                          <span className="ml-1 text-xs font-normal text-gray-500">
                            (leave blank to show for all packages)
                          </span>
                        </span>
                        <div className="flex flex-wrap gap-3">
                          {variationOptions.map((variation) => {
                            const checked = scene.variationIds.includes(variation.id);
                            return (
                              <label
                                key={variation.id}
                                className="flex items-center gap-2 rounded border border-gray-200 bg-slate-50 px-3 py-1 text-xs font-medium text-gray-700"
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-gray-300"
                                  checked={checked}
                                  onChange={(event) => {
                                    const next = event.target.checked
                                      ? Array.from(new Set([...scene.variationIds, variation.id]))
                                      : scene.variationIds.filter((id) => id !== variation.id);
                                    onSceneChange(scene.id, { variationIds: next });
                                  }}
                                />
                                {variation.name || "Variation"}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="grid gap-2">
                        <span className="text-sm font-medium text-gray-700">Artwork</span>
                        <div className="flex items-center gap-3">
                          <div className="relative h-32 w-48 overflow-hidden rounded border bg-slate-100">
                            {preview ? (
                              <Image
                                src={preview}
                                alt={`${scene.title || `Scene ${index + 1}`} artwork`}
                                fill
                                sizes="192px"
                                className="object-cover"
                              />
                            ) : (
                              <div className="grid h-full place-items-center text-xs text-gray-400">
                                No image
                              </div>
                            )}
                          </div>
                          <div className="grid gap-2 text-xs">
                            <label className="btn btn-xs">
                              Upload image
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(event) =>
                                  onSceneImageSelect(
                                    scene.id,
                                    event.target.files && event.target.files.length > 0
                                      ? event.target.files[0]
                                      : null
                                  )
                                }
                              />
                            </label>
                            {preview ? (
                              <button
                                type="button"
                                className="btn btn-ghost btn-xs text-rose-600"
                                onClick={() => onSceneImageSelect(scene.id, null)}
                              >
                                Remove image
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-xs"
                              onClick={() => onGenerateSceneImage(scene.id)}
                              disabled={generating}
                            >
                              {generating ? "Generating…" : "Generate with AI"}
                            </button>
                            {scene.persistedImage ? (
                              <span className="text-[11px] text-emerald-600">
                                Saved to library
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {scene.aiError ? (
                          <p className="text-xs text-rose-600">{scene.aiError}</p>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <p className="rounded border border-dashed border-slate-300 bg-white p-4 text-sm text-gray-500">
          Enable the storyboard to unlock a timeline preview and collect example scenes
          for this product.
        </p>
      )}
    </section>
  );
};

export default ProductStoryboardEditor;
