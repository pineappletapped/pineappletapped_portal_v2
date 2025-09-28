import './globals.css';
import Link from 'next/link';
import { CartProvider } from '@/lib/cart';
import SiteHeader from '@/components/SiteHeader';
import { getCategories } from '@/lib/categories';
import { getProducts } from '@/lib/products';
import { FaLinkedin, FaInstagram, FaYoutube, FaTiktok } from 'react-icons/fa6';
import CookieBanner from '@/components/CookieBanner';
import AnalyticsScripts from '@/components/AnalyticsScripts';
import AnalyticsTracker from '@/components/AnalyticsTracker';
import LoginTelemetryListener from '@/components/LoginTelemetryListener';

export const metadata = {
  title: 'Pineapple Portal',
  description: 'Client portal',
  icons: { icon: '/logo-icon.svg' },
};
export const viewport = { width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [categories, products] = await Promise.all([
    getCategories(),
    getProducts(),
  ]);

  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-light-gray text-charcoal">
        <CartProvider>
          <LoginTelemetryListener />
          <SiteHeader categories={categories} products={products} />
          <main className="flex-1">{children}</main>
          <footer className="border-t bg-white">
            <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-charcoal flex justify-between items-center flex-col sm:flex-row gap-4">
              <p>© {new Date().getFullYear()} Pineapple Tapped</p>
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex gap-4">
                  <Link href="/blog" className="hover:underline">
                    Blog
                  </Link>
                  <Link href="/privacy" className="hover:underline">
                    Privacy
                  </Link>
                  <Link href="/join-team" className="hover:underline">
                    Join Our Team
                  </Link>
                </div>
                <div className="flex gap-4 justify-center">
                  {[
                    {
                      href: 'https://www.linkedin.com/company/pineappletapped',
                      Icon: FaLinkedin,
                    },
                    {
                      href: 'https://www.instagram.com/pineappletapped',
                      Icon: FaInstagram,
                    },
                    {
                      href: 'https://www.youtube.com/@pineappletapped7015',
                      Icon: FaYoutube,
                    },
                    {
                      href: 'https://www.tiktok.com/@pineappletapped',
                      Icon: FaTiktok,
                    },
                  ].map(({ href, Icon }) => (
                    <a
                      key={href}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-8 h-8 rounded-full bg-blue text-white flex items-center justify-center hover:bg-orange"
                    >
                      <Icon className="w-4 h-4" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </footer>
          <CookieBanner />
          <AnalyticsScripts />
          <AnalyticsTracker />
        </CartProvider>
      </body>
    </html>
  );
}
