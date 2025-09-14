"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FiSearch } from "react-icons/fi";
import { getProducts } from "@/lib/products";

export default function SearchBar() {
  const [term, setTerm] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    try {
      const products = await getProducts();
      const matches = products.filter((p) => {
        const text = `${p.name} ${p.tagline ?? ""}`.toLowerCase();
        return text.includes(q.toLowerCase());
      });
      if (matches.length === 1) {
        router.push(`/products/${matches[0].id}`);
      } else {
        router.push(`/search?q=${encodeURIComponent(q)}`);
      }
    } catch {
      router.push(`/search?q=${encodeURIComponent(q)}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <input
        type="text"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search services"
        className="border rounded pl-3 pr-8 py-1 text-sm"
      />
      <button
        type="submit"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500"
        aria-label="Search"
      >
        <FiSearch className="w-4 h-4" />
      </button>
    </form>
  );
}

