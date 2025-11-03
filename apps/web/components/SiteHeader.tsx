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
import { getAssetUrl } from '@/lib/asset-url';

export default function SiteHeader({
  categories,
  products,
}: {
  categories: Category[];
  products: Product[];
}) {
  const { items, remove } = useCart();
  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoUrl, setLogoUrl] = useState(() => getAssetUrl('/logo-rectangle.svg'));
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  const cartSectionRef = useRef<HTMLDivElement | null>(null);
  const flyoutId = 'site-header-category-flyout';
  const formatCurrency = (value: number) => `£${value.toFixed(2)}`;
  const productSubtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const rentalSubtotal = items.reduce(
    (sum, item) => sum + (item.rentalTotal || 0) * item.quantity,
    0
  );
  const combinedSubtotal = productSubtotal + rentalSubtotal;

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

  const handleCartBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as HTMLElement | null;
    if (next && cartSectionRef.current?.contains(next)) {
      return;
    }
    setCartOpen(false);
  };

  const handleCartKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setCartOpen(false);
      const trigger = cartSectionRef.current?.querySelector<HTMLAnchorElement>(
        '[data-cart-trigger="true"]'
      );
      trigger?.focus();
    }
  };

  const handleCartMouseEnter = () => {
    setCartOpen(true);
  };

  const handleCartMouseLeave = () => {
    const activeElement = document.activeElement as HTMLElement | null;
    if (activeElement && cartSectionRef.current?.contains(activeElement)) {
      return;
    }
    setCartOpen(false);
  };

  useEffect(() => {
    (async () => {
      try {
        const { doc, getDoc } = await import('firebase/firestore');
        const database = await getDb();
        if (!database) return;
        const snap = await getDoc(doc(database, 'settings', 'branding'));
        const data = snap.data() as any;
        if (data?.logoUrl) {
          setLogoUrl(
            data.logoUrl.startsWith('http') ? data.logoUrl : getAssetUrl(data.logoUrl),
          );
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    if (cartOpen && items.length === 0) {
      setCartOpen(false);
    }
  }, [cartOpen, items.length]);

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
          <div
            className="relative"
            ref={cartSectionRef}
            onMouseEnter={handleCartMouseEnter}
            onMouseLeave={handleCartMouseLeave}
            onFocusCapture={() => setCartOpen(true)}
            onBlurCapture={handleCartBlur}
          >
            <Link
              href="/cart"
              data-cart-trigger="true"
              className="relative flex items-center justify-center rounded-full p-2 text-blue transition-colors hover:text-orange focus-visible:text-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
              aria-label={
                count > 0
                  ? `View cart with ${count} item${count === 1 ? '' : 's'}`
                  : 'View cart'
              }
              onClick={() => setCartOpen(false)}
            >
              <FiShoppingCart className="w-5 h-5" />
              {count > 0 && (
                <span className="absolute -top-2 -right-2 bg-orange text-white rounded-full text-xs px-1">
                  {count}
                </span>
              )}
            </Link>
            {cartOpen && (
              <div
                className="absolute right-0 mt-2 w-72 z-20 rounded-md border border-slate-200 bg-white p-3 text-sm shadow-lg"
                onKeyDown={handleCartKeyDown}
              >
                {items.length === 0 ? (
                  <p className="py-4 text-center text-slate-500">Your Cart is Currently Empty</p>
                ) : (
                  <>
                    <ul className="max-h-60 space-y-3 overflow-auto">
                      {items.map((item, index) => (
                        <li
                          key={`${item.id}-${index}`}
                          className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0"
                        >
                          <div className="flex-1 space-y-1">
                            <span className="block font-medium text-blue">{item.name}</span>
                            {item.variation && (
                              <span className="block text-xs text-slate-500">{item.variation}</span>
                            )}
                            {item.date && <span className="block text-xs text-slate-500">{item.date}</span>}
                          </div>
                          <div className="flex flex-col items-end gap-1 text-right">
                            <div className="space-y-0.5">
                              <span className="block text-xs text-slate-500">
                                {formatCurrency(item.price)} each
                              </span>
                              <span className="block text-sm font-semibold text-blue">
                                {formatCurrency(item.price * item.quantity)}
                              </span>
                              {item.rentalTotal ? (
                                <span className="block text-xs text-slate-500">
                                  +{formatCurrency((item.rentalTotal || 0) * item.quantity)} rent
                                </span>
                              ) : null}
                            </div>
                            <span className="text-xs font-semibold text-blue">×{item.quantity}</span>
                            <button
                              type="button"
                              onClick={() => {
                                remove(index);
                                if (items.length === 1) {
                                  setCartOpen(false);
                                }
                              }}
                              className="rounded border border-transparent px-2 py-1 text-xs text-slate-500 transition hover:text-orange focus-visible:border-orange focus-visible:text-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange"
                              aria-label={`Remove ${item.name} from cart`}
                            >
                              Remove
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 space-y-2">
                      {rentalSubtotal > 0 && (
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>Rental included</span>
                          <span>{formatCurrency(rentalSubtotal)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-blue">
                        <span>Subtotal</span>
                        <span>{formatCurrency(combinedSubtotal)}</span>
                      </div>
                    </div>
                  </>
                )}
                <Link
                  href="/cart"
                  className="mt-3 inline-flex w-full items-center justify-center rounded bg-orange px-3 py-2 text-sm font-semibold text-white transition hover:bg-orange/90"
                  onClick={() => setCartOpen(false)}
                >
                  View Cart{count > 0 ? ` (${count})` : ''}
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

