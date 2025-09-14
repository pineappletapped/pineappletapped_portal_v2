"use client";

import { useMemo, useState } from "react";
import ProductCard from "./ProductCard";
import { Product } from "@/lib/products";

export default function ExhibitionProductList({ products }: { products: Product[] }) {
  const [search, setSearch] = useState("");
  const [venue, setVenue] = useState("");
  const [month, setMonth] = useState("");

  const venues = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.venue) set.add(p.venue);
    });
    return Array.from(set).sort();
  }, [products]);

  const months = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.eventDate) set.add(p.eventDate.slice(0, 7));
    });
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (venue && p.venue !== venue) {
        return false;
      }
      if (month && (!p.eventDate || !p.eventDate.startsWith(month))) {
        return false;
      }
      return true;
    });
  }, [products, search, venue, month]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2 items-end">
        <input
          type="text"
          placeholder="Search events"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border p-2 flex-1 min-w-[12rem]"
        />
        <select
          value={venue}
          onChange={(e) => setVenue(e.target.value)}
          className="border p-2"
        >
          <option value="">All venues</option>
          {venues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border p-2"
        >
          <option value="">All months</option>
          {months.map((m) => {
            const [y, mo] = m.split("-");
            const date = new Date(Number(y), Number(mo) - 1);
            const label = date.toLocaleString("default", {
              month: "long",
              year: "numeric",
            });
            return (
              <option key={m} value={m}>
                {label}
              </option>
            );
          })}
        </select>
      </div>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
        {filtered.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
      {filtered.length === 0 && <p>No events found.</p>}
    </div>
  );
}

