'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface HeroSectionProps {
  title: string;
  subtitle: string;
  videoSrc: string;
  posterSrc: string;
  posterAlt: string;
}

const mediaQuery = '(prefers-reduced-motion: reduce)';

function getShouldShowVideo(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  const query = window.matchMedia(mediaQuery);
  return !query.matches;
}

export default function HeroSection({
  title,
  subtitle,
  videoSrc,
  posterSrc,
  posterAlt,
}: HeroSectionProps) {
  const [showVideo, setShowVideo] = useState<boolean>(false);

  useEffect(() => {
    setShowVideo(getShouldShowVideo());

    if (typeof window === 'undefined') {
      return undefined;
    }

    const query = window.matchMedia(mediaQuery);
    const handleChange = () => setShowVideo(!query.matches);

    if (query.addEventListener) {
      query.addEventListener('change', handleChange);
      return () => query.removeEventListener('change', handleChange);
    }

    query.addListener(handleChange);
    return () => query.removeListener(handleChange);
  }, []);

  return (
    <section className="relative w-full h-[60vh] overflow-hidden">
      {showVideo ? (
        <video
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          poster={posterSrc}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
      ) : (
        <Image
          src={posterSrc}
          alt={posterAlt}
          fill
          sizes="100vw"
          priority
          className="absolute inset-0 object-cover"
        />
      )}
      <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-center text-white px-4">
        <h1 className="text-4xl md:text-6xl font-bold mb-4">{title}</h1>
        <p className="max-w-2xl mb-6">{subtitle}</p>
        <div className="flex gap-4">
          <Link href="/categories" className="btn">
            Browse Services
          </Link>
          <Link href="/cart" className="btn-outline">
            View Cart
          </Link>
        </div>
      </div>
    </section>
  );
}
