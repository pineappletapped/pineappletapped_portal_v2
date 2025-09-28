export interface KitAssignment {
  id: string;
  name: string | null;
  category: string | null;
  start: string | null;
  end: string | null;
}

export interface KitSummary {
  items: KitAssignment[];
  label: string;
  hasDrone: boolean;
  window: string | null;
}

const parseIsoDate = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const normaliseKitItems = (input: unknown): KitAssignment[] => {
  if (!Array.isArray(input)) {
    return [];
  }
  const items: KitAssignment[] = [];
  input.forEach((raw) => {
    if (!raw || typeof raw !== "object") {
      return;
    }
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      return;
    }
    const name =
      typeof record.name === "string" && record.name.trim().length > 0
        ? record.name.trim()
        : null;
    const category =
      typeof record.category === "string" && record.category.trim().length > 0
        ? record.category.trim()
        : null;
    const start = typeof record.start === "string" ? record.start : null;
    const end = typeof record.end === "string" ? record.end : null;
    items.push({ id, name, category, start, end });
  });
  return items;
};

export const summariseKitItems = (input: unknown): KitSummary | null => {
  const items = normaliseKitItems(input);
  if (items.length === 0) {
    return null;
  }

  const hasDrone = items.some((item) => {
    const name = item.name?.toLowerCase() ?? "";
    const category = item.category?.toLowerCase() ?? "";
    return name.includes("drone") || category.includes("drone");
  });

  const label = items
    .map((item) => {
      const base = item.name || item.id;
      if (item.category && item.category.length > 0) {
        const lowerBase = base.toLowerCase();
        return lowerBase.includes(item.category.toLowerCase())
          ? base
          : `${base} (${item.category})`;
      }
      return base;
    })
    .join(", ");

  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const starts = items
    .map((item) => parseIsoDate(item.start))
    .filter((value): value is Date => value instanceof Date);
  const ends = items
    .map((item) => parseIsoDate(item.end))
    .filter((value): value is Date => value instanceof Date);

  let window: string | null = null;
  if (starts.length || ends.length) {
    const startDate = starts.length
      ? new Date(Math.min(...starts.map((value) => value.getTime())))
      : null;
    const endDate = ends.length
      ? new Date(Math.max(...ends.map((value) => value.getTime())))
      : null;
    if (startDate && endDate) {
      window = `${formatter.format(startDate)} – ${formatter.format(endDate)}`;
    } else if (startDate) {
      window = `From ${formatter.format(startDate)}`;
    } else if (endDate) {
      window = `Until ${formatter.format(endDate)}`;
    }
  }

  return { items, label, hasDrone, window };
};
