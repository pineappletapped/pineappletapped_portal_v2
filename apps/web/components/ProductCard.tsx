"use client";

import Link from "next/link";
import Image from "next/image";
import { Product } from "@/lib/products";
import { FiCalendar, FiMapPin } from "react-icons/fi";

export default function ProductCard({ product }: { product: Product }) {
  const basePrices = [product.price, ...(product.variations?.map(v => v.price) || [])];
  const min = Math.min(...basePrices);
  const max = Math.max(...basePrices);
  const priceLabel =
    min === max ? `£${min.toFixed(2)}` : `£${min.toFixed(2)} - £${max.toFixed(2)}`;
  const img =
    product.imageUrl || "https://placehold.co/600x400?text=No+Image";

  return (
    <div className="card p-4 flex flex-col gap-2 text-sm">
      <Image
        src={img}
        alt={product.name}
        width={600}
        height={400}
        className="w-full h-40 object-cover rounded"
      />
      <h3 className="font-medium text-sm">{product.name}</h3>
      {product.tagline && (
        <p className="text-xs text-gray-600">{product.tagline}</p>
      )}
      {product.category === "exhibition-videography" && (
        <>
          {product.eventDate && (
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <FiCalendar className="w-3 h-3" />
              {new Date(product.eventDate).toLocaleDateString()}
            </div>
          )}
          {product.venue && (
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <FiMapPin className="w-3 h-3" />
              {product.venue}
            </div>
          )}
        </>
      )}
      <p className="font-bold text-sm">{priceLabel}</p>
      <Link href={`/products/${product.id}`} className="btn btn-sm mt-auto">
        Learn More
      </Link>
    </div>
  );
}
