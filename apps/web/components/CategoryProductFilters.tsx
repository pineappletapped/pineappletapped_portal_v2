"use client";

import {
  cloneElement,
  isValidElement,
  useId,
  useMemo,
  useState,
} from "react";
import type { ReactElement } from "react";
import ProductCard from "./ProductCard";
import ProductListRow from "./ProductListRow";
import type { Product } from "@/lib/products";

type SortOption =
  | "default"
  | "price-asc"
  | "price-desc"
  | "name-asc"
  | "date-desc"
  | "date-asc";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "default", label: "Recommended" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "name-asc", label: "Name: A to Z" },
  { value: "date-desc", label: "Date: Newest First" },
  { value: "date-asc", label: "Date: Oldest First" },
];

function getStartingPrice(product: Product): number | null {
  const prices: number[] = [];
  if (typeof product.price === "number" && !Number.isNaN(product.price)) {
    prices.push(product.price);
  }
  if (Array.isArray(product.variations)) {
    for (const variation of product.variations) {
      if (typeof variation?.price === "number" && !Number.isNaN(variation.price)) {
        prices.push(variation.price);
      }
    }
  }
  if (prices.length === 0) return null;
  return Math.min(...prices);
}

function getComparableTimestamp(product: Product): number {
  if (product.eventDate) {
    const eventTime = Date.parse(product.eventDate);
    if (!Number.isNaN(eventTime)) {
      return eventTime;
    }
  }
  const createdAt = (product as any)?.createdAt;
  if (!createdAt) return 0;
  if (typeof createdAt === "number") return createdAt;
  if (typeof createdAt === "string") {
    const created = Date.parse(createdAt);
    return Number.isNaN(created) ? 0 : created;
  }
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === "object") {
    if (typeof createdAt.toDate === "function") {
      const date = createdAt.toDate();
      if (date instanceof Date) {
        return date.getTime();
      }
      const fallback = Date.parse(String(date));
      if (!Number.isNaN(fallback)) {
        return fallback;
      }
    }
    if (typeof createdAt.seconds === "number") {
      const base = createdAt.seconds * 1000;
      const nanos = typeof createdAt.nanoseconds === "number" ? createdAt.nanoseconds / 1_000_000 : 0;
      return base + nanos;
    }
  }
  return 0;
}

function sortProducts(products: Product[], sort: SortOption): Product[] {
  if (sort === "default") return products;
  const sorted = [...products];
  switch (sort) {
    case "price-asc":
      sorted.sort((a, b) => {
        const priceA = getStartingPrice(a);
        const priceB = getStartingPrice(b);
        if (priceA === null && priceB === null) return 0;
        if (priceA === null) return 1;
        if (priceB === null) return -1;
        return priceA - priceB;
      });
      break;
    case "price-desc":
      sorted.sort((a, b) => {
        const priceA = getStartingPrice(a);
        const priceB = getStartingPrice(b);
        if (priceA === null && priceB === null) return 0;
        if (priceA === null) return 1;
        if (priceB === null) return -1;
        return priceB - priceA;
      });
      break;
    case "name-asc":
      sorted.sort((a, b) => {
        const nameA = (a.name || "").toLowerCase();
        const nameB = (b.name || "").toLowerCase();
        return nameA.localeCompare(nameB);
      });
      break;
    case "date-desc":
      sorted.sort((a, b) => getComparableTimestamp(b) - getComparableTimestamp(a));
      break;
    case "date-asc":
      sorted.sort((a, b) => getComparableTimestamp(a) - getComparableTimestamp(b));
      break;
  }
  return sorted;
}

interface CategoryProductFiltersProps {
  products: Product[];
  children: ReactElement<{ products: Product[] }>;
}

export default function CategoryProductFilters({
  products,
  children,
}: CategoryProductFiltersProps) {
  const [sort, setSort] = useState<SortOption>("default");
  const selectId = useId();

  const sortedProducts = useMemo(
    () => sortProducts(products, sort),
    [products, sort]
  );

  const renderedChildren = useMemo(() => {
    if (!isValidElement(children)) {
      return null;
    }
    return cloneElement(children, {
      products: sortedProducts,
    });
  }, [children, sortedProducts]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <label className="text-sm font-medium text-gray-700" htmlFor={selectId}>
          Sort by
        </label>
        <select
          id={selectId}
          className="select select-bordered select-sm"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortOption)}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {renderedChildren}
    </div>
  );
}

export function CategoryProductGrid({
  products,
}: {
  products: Product[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}

export function CategoryProductList({
  products,
}: {
  products: Product[];
}) {
  return (
    <div className="grid gap-4">
      {products.map((product) => (
        <ProductListRow key={product.id} product={product} />
      ))}
    </div>
  );
}
