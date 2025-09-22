'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect, useRef } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { FiSearch, FiShoppingCart, FiMenu, FiX } from 'react-icons/fi';
import SearchBar from '@/components/SearchBar';
import AuthLinks from '@/components/AuthLinks';
import { useCart } from '@/lib/cart';
import type { Category } from '@/lib/categories';
import type { Product } from '@/lib/products';
import { getDb } from '@/lib/firebase';

export default function SiteHeader({
  categories,
  products,
}: {
  categories: Category[];
  products: Product[];
}) {
  const { items } = useCart();
  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState('/logo-rectangle.svg');
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const flyoutId = 'site-header-category-flyout';

  const makeTriggerId = (catId: string) => `site-header-cat-${catId}`;

  const handleTriggerBlur = (catId: string) =>
    (event: FocusEvent<HTMLAnchorElement>) => {
      const next = event.relatedTarget as HTMLElement | null;
      if (next && flyoutRef.current?.contains(next)) {
        return;
      }
      setOpenCat((current) => (current === catId ? null : current));
    };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpenCat(null);
      event.currentTarget.blur();
    }
  };

  const handleFlyoutKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      const current = openCat;
      setOpenCat(null);
      if (current) {
        const trigger = document.getElementById(makeTriggerId(current));
        trigger?.focus();
      }
    }
  };

  const handleFlyoutBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as HTMLElement | null;
    if (next && flyoutRef.current?.contains(next)) {
      return;
    }
    setOpenCat(null);
  };

  useEffect(() => {
    (async () => {
      try {
        const { doc, getDoc } = await import('firebase/firestore');
        const database = await getDb();
        if (!database) return;
        const snap = await getDoc(doc(database, 'settings', 'branding'));
        const data = snap.data() as any;
        if (data?.logoUrl) setLogoUrl(data.logoUrl);
      } catch {
        // ignore
      }
    })();
  }, []);

  const topCats = categories
    .filter((c) => !c.parentId)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const getSubcats = (id: string) =>
    categories
      .filter((c) => c.parentId === id)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  const getProducts = (id: string) => products.filter((p) => p.category === id);

  const activeCat = openCat ? topCats.find((c) => c.id === openCat) : null;
  const openGroups = activeCat
    ? (() => {
        const subs = getSubcats(activeCat.id);
        return subs.length ? subs : [activeCat];
      })()
    : [];

  return (
    <header className="border-b bg-white text-blue">
      <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Open menu"
            className="md:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <FiMenu className="w-6 h-6" />
          </button>
          <Link href="/" className="block">
            <Image src={logoUrl} alt="Pineapple Tapped" width={160} height={40} priority />
          </Link>
        </div>
        <nav className="hidden md:flex items-center gap-4 text-sm">
          <Link href="/" className="hover:underline">Home</Link>
          {topCats.map((cat) => (
            <div key={cat.id} onMouseEnter={() => setOpenCat(cat.id)}>
              <Link
                id={makeTriggerId(cat.id)}
                href={`/categories/${cat.slug}`}
                className={`hover:underline pb-1 ${
                  openCat === cat.id ? 'text-orange border-b-2 border-orange' : ''
                }`}
                onFocus={() => setOpenCat(cat.id)}
                onBlur={handleTriggerBlur(cat.id)}
                onKeyDown={handleTriggerKeyDown}
                aria-expanded={openCat === cat.id}
                aria-controls={flyoutId}
                aria-haspopup="true"
              >
                {cat.name}
              </Link>
            </div>
          ))}
          <Link href="/contact" className="hover:underline">Contact</Link>
        </nav>
        {openCat && (
          <div
            onMouseLeave={() => setOpenCat(null)}
            onKeyDown={handleFlyoutKeyDown}
            onBlur={handleFlyoutBlur}
            id={flyoutId}
            ref={flyoutRef}
            className="hidden md:block fixed left-0 right-0 top-16 z-20 bg-white shadow-lg border-b"
          >
            <div className="mx-auto max-w-6xl p-6 grid grid-cols-3 gap-6">
              {openGroups.map((sub) => (
                <div key={sub.id} className="min-w-[150px]">
                  <Link
                    href={`/categories/${sub.slug}`}
                    className="font-semibold mb-2 block hover:underline"
                  >
                    {sub.name}
                  </Link>
                  <ul className="space-y-1">
                    {getProducts(sub.id).map((p) => (
                      <li key={p.id}>
                        <Link href={`/products/${p.id}`} className="text-sm hover:underline">
                          {p.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-4">
          <div className="relative">
            <button type="button" aria-label="Search" onClick={() => setSearchOpen((o) => !o)}>
              <FiSearch className="w-5 h-5" />
            </button>
            {searchOpen && (
              <div className="absolute right-0 mt-2 z-10">
                <SearchBar />
              </div>
            )}
          </div>
          <div className="relative">
            <button type="button" aria-label="Cart" onClick={() => setCartOpen((o) => !o)} className="relative">
              <FiShoppingCart className="w-5 h-5" />
              {count > 0 && (
                <span className="absolute -top-2 -right-2 bg-orange text-white rounded-full text-xs px-1">
                  {count}
                </span>
              )}
            </button>
            {cartOpen && (
              <div className="absolute right-0 mt-2 z-10 bg-white border rounded shadow p-2 text-sm">
                <Link href="/cart" className="hover:underline" onClick={() => setCartOpen(false)}>
                  View Cart ({count})
                </Link>
              </div>
            )}
          </div>
          <AuthLinks size="xs" />
        </div>
      </div>
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30 bg-white p-4 overflow-y-auto text-blue">
          <div className="flex items-center justify-between mb-4">
            <Link href="/" className="block" onClick={() => setMobileOpen(false)}>
              <Image src={logoUrl} alt="Pineapple Tapped" width={140} height={35} />
            </Link>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
            >
              <FiX className="w-6 h-6" />
            </button>
          </div>
          <nav className="flex flex-col gap-4 text-lg">
            <Link href="/" onClick={() => setMobileOpen(false)} className="hover:underline">
              Home
            </Link>
            {topCats.map((cat) => (
              <Link
                key={cat.id}
                href={`/categories/${cat.slug}`}
                onClick={() => setMobileOpen(false)}
                className="hover:underline"
              >
                {cat.name}
              </Link>
            ))}
            <Link href="/contact" onClick={() => setMobileOpen(false)} className="hover:underline">
              Contact
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}

