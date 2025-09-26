"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FiSearch } from "react-icons/fi";

interface Suggestion {
  id: string;
  name: string;
  tagline: string | null;
  exact: boolean;
}

export default function SearchBar() {
  const [term, setTerm] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const debounceRef = useRef<number>();
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const q = term.trim();
    if (!q) {
      setSuggestions([]);
      setOpen(false);
      abortRef.current?.abort();
      return undefined;
    }

    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      try {
        const res = await fetch(
          `/api/search/products?q=${encodeURIComponent(q)}&limit=5`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error("Search failed");
        const data = await res.json();
        setSuggestions(data.results ?? []);
        setOpen(true);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setSuggestions([]);
          setOpen(false);
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    }, 250);

    return () => {
      window.clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [term]);

  useEffect(() => {
    const handleClickAway = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickAway);
    return () => document.removeEventListener("mousedown", handleClickAway);
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = term.trim();
    if (!q) return;

    try {
      const res = await fetch(
        `/api/search/products?q=${encodeURIComponent(q)}&limit=1`
      );
      if (res.ok) {
        const data = await res.json();
        const first: Suggestion | undefined = data.results?.[0];
        if (first && (first.exact || data.results.length === 1)) {
          router.push(`/products/${first.id}`);
          setOpen(false);
          return;
        }
      }
    } catch {
      // ignore and fall back to results page
    }

    router.push(`/search?q=${encodeURIComponent(q)}`);
    setOpen(false);
  }

  return (
    <div className="relative" ref={containerRef}>
      <form onSubmit={handleSubmit} className="relative">
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search services"
          className="border rounded pl-3 pr-8 py-1 text-sm"
          aria-autocomplete="list"
          aria-controls="site-search-suggestions"
        />
        <button
          type="submit"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500"
          aria-label="Search"
        >
          <FiSearch className="w-4 h-4" />
        </button>
      </form>
      {open && (suggestions.length > 0 || loading) && (
        <div
          id="site-search-suggestions"
          role="listbox"
          className="absolute right-0 mt-1 w-72 max-w-xs rounded-md border border-slate-200 bg-white text-sm shadow-lg"
        >
          {loading && suggestions.length === 0 ? (
            <p className="p-3 text-slate-500">Searching…</p>
          ) : suggestions.length === 0 ? (
            <p className="p-3 text-slate-500">No results</p>
          ) : (
            <ul role="presentation">
              {suggestions.map((suggestion) => (
                <li
                  key={suggestion.id}
                  role="option"
                  aria-selected="false"
                >
                  <Link
                    href={`/products/${suggestion.id}`}
                    className="block px-3 py-2 hover:bg-slate-100 focus:bg-slate-100"
                    onClick={() => setOpen(false)}
                  >
                    <span className="block font-medium text-blue">
                      {suggestion.name}
                    </span>
                    {suggestion.tagline && (
                      <span className="block text-xs text-slate-500">
                        {suggestion.tagline}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

