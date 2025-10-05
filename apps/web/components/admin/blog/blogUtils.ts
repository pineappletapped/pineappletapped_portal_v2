export interface BlogCategory {
  id: string;
  name: string;
  slug: string;
}

export interface BlogPostRecord {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  heroImageUrl?: string;
  videoUrl?: string;
  categories: string[];
  tags: string[];
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords: string[];
  relatedProductIds: string[];
  relatedPostId?: string | null;
  isVisible: boolean;
  publishAt?: Date | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export interface BlogPostForm {
  id?: string;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  heroImageUrl?: string;
  videoUrl: string;
  categories: string[];
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string[];
  relatedProductIds: string[];
  relatedPostId: string;
  isVisible: boolean;
  publishAt: string;
}

export interface ProductOption {
  id: string;
  name: string;
  hidden?: boolean;
}

export const emptyPostForm: BlogPostForm = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  heroImageUrl: undefined,
  videoUrl: "",
  categories: [],
  tags: [],
  seoTitle: "",
  seoDescription: "",
  seoKeywords: [],
  relatedProductIds: [],
  relatedPostId: "",
  isVisible: false,
  publishAt: "",
};

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function timestampToDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000 + (value.nanoseconds || 0) / 1e6);
  }
  return null;
}

export function ensureStringArray(value: any): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : String(item ?? "")))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

export function formatDateTimeLocal(date: Date | null | undefined): string {
  if (!date) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function formatDisplayDate(date: Date | null | undefined): string {
  if (!date) return "Not scheduled";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
}
