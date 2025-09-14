'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { Product } from '@/lib/products';

export default function CategoryMenu({
  title,
  href,
  items,
}: {
  title: string;
  href: string;
  items: Product[];
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const toggle = () => setOpen((v) => !v);
  const close = () => setOpen(false);

  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          close();
          buttonRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          close();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-sm btn-ghost"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
        onFocus={() => setOpen(true)}
      >
        {title}
      </button>
      {open && items.length > 0 && (
        <div className="absolute left-0 top-full z-10 flex min-w-[200px] flex-col rounded-md border bg-white py-2 shadow-lg">
          <Link
            href={href}
            className="px-4 py-2 text-sm hover:bg-gray-100"
            onClick={close}
          >
            View all {title}
          </Link>
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/products/${item.id}`}
              className="px-4 py-2 text-sm hover:bg-gray-100"
              onClick={close}
            >
              {item.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
