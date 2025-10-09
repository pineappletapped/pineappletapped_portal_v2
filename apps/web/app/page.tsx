import Link from 'next/link';
import Image from 'next/image';
import HeroSection from '@/components/HeroSection';
import ProductCard from '@/components/ProductCard';
import CategoryCard from '@/components/CategoryCard';
import { getProducts } from '@/lib/products';
import { getPosts } from '@/lib/blog';
import { getClientLogos } from '@/lib/clientLogos';
import { getCategories } from '@/lib/categories';
import { getHomepage } from '@/lib/homepage';
import ProcessSection from '@/components/ProcessSection';

export default async function Home() {
  const [homepage, products, posts, logos, categories] = await Promise.all([
    getHomepage(),
    getProducts(),
    getPosts(),
    getClientLogos(),
    getCategories(),
  ]);
  const popular = products.slice(0, 3);
  const recent = posts.slice(0, 2);
  const topCategories = categories.filter((c) => !c.parentId);

  return (
    <div className="flex flex-col"> 
      <HeroSection
        title={homepage.heroTitle}
        subtitle={homepage.heroSubtitle}
        videoSrc={homepage.heroVideoUrl}
        posterSrc={homepage.heroPosterUrl}
        posterAlt={homepage.heroPosterAlt}
      />

      <ProcessSection
        title={homepage.processTitle}
        description={homepage.processDescription}
        videoUrl={homepage.processVideoUrl}
        posterUrl={homepage.processPosterUrl}
        stages={homepage.processStages}
      />

      {homepage.cards.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-16">
          <div className="grid gap-6 md:grid-cols-3">
            {homepage.cards.map((c: any) => (
              <div key={c.id} className="border rounded p-4 text-center">
                <h3 className="font-semibold mb-2">{c.title}</h3>
                <p className="text-sm text-gray-700 mb-2">{c.text}</p>
                {c.link && (
                <Link href={c.link} className="text-orange hover:underline">
                    Learn more
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Categories */}
      {topCategories.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold mb-6 text-center">Our Services</h2>
          <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3">
            {topCategories.map((c) => (
              <CategoryCard key={c.id} category={c} />
            ))}
          </div>
        </section>
      )}

      {/* About Us */}
      <section className="mx-auto max-w-5xl px-4 py-16 text-center">
        <h2 className="text-3xl font-semibold mb-4">{homepage.aboutTitle}</h2>
        <p className="text-gray-700">{homepage.aboutText}</p>
      </section>

      {/* Popular Products */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold mb-6 text-center">Popular Services</h2>
        <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3">
          {popular.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      {/* Corporate Podcast CTA */}
      <section className="bg-orange text-white py-16 text-center">
        <h2 className="text-3xl font-semibold mb-4">{homepage.ctaTitle}</h2>
        <p className="max-w-2xl mx-auto mb-6">{homepage.ctaText}</p>
        <Link href={homepage.ctaButtonLink} className="btn bg-white text-orange">
          {homepage.ctaButtonText}
        </Link>
      </section>

      {/* Blog Posts */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold mb-6 text-center">From the Blog</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {recent.map((p) => {
            const slug = p.slug || p.id;
            return (
              <article key={p.id} className="border rounded-md overflow-hidden">
                {p.imageUrl && (
                  <Image
                    src={p.imageUrl}
                    alt={p.title}
                    width={800}
                    height={320}
                    className="h-40 w-full object-cover"
                  />
                )}
                <div className="p-4">
                  <h3 className="font-semibold mb-2">{p.title}</h3>
                  <p className="text-sm text-gray-600 mb-2">{p.excerpt}</p>
                  <Link href={`/blog/${slug}`} className="text-orange hover:underline">
                    Read more
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
        <div className="text-center mt-6">
          <Link href="/blog" className="text-orange hover:underline">
            View all posts
          </Link>
        </div>
      </section>

      {logos.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h2 className="text-2xl font-semibold mb-6">Trusted By</h2>
          <div className="flex flex-wrap justify-center gap-8">
            {logos.map((l) => (
              <Image
                key={l.id}
                src={l.imageUrl}
                alt={l.name}
                width={160}
                height={64}
                className="h-16 object-contain"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
