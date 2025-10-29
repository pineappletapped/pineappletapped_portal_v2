import './globals.css';
import NextLink from 'next/link';
import { CartProvider } from '@/lib/cart';
import SiteHeader from '@/components/SiteHeader';
import { getCategories } from '@/lib/categories';
import { getProducts } from '@/lib/products';
import CookieBanner from '@/components/CookieBanner';
import AnalyticsScripts from '@/components/AnalyticsScripts';
import AnalyticsTracker from '@/components/AnalyticsTracker';
import PineappleThemeProvider from '@/components/theme/ThemeProvider';
import {
  Box,
  Container,
  IconButton,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import InstagramIcon from '@mui/icons-material/Instagram';
import YouTubeIcon from '@mui/icons-material/YouTube';
import MusicNoteIcon from '@mui/icons-material/MusicNote';

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
      <body>
        <PineappleThemeProvider>
          <CartProvider>
            <SiteHeader categories={categories} products={products} />
            <Box component="main" sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {children}
            </Box>
            <Box component="footer" sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
              <Container maxWidth="lg" sx={{ py: { xs: 4, md: 5 } }}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                  spacing={3}
                  sx={{ color: 'text.secondary' }}
                >
                  <Typography variant="body2" color="text.primary">
                    © {new Date().getFullYear()} Pineapple Tapped
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                    <Stack direction="row" spacing={2}>
                      <MuiLink component={NextLink} href="/blog" underline="hover" color="text.primary">
                        Blog
                      </MuiLink>
                      <MuiLink component={NextLink} href="/privacy" underline="hover" color="text.primary">
                        Privacy
                      </MuiLink>
                      <MuiLink component={NextLink} href="/join-team" underline="hover" color="text.primary">
                        Join Our Team
                      </MuiLink>
                    </Stack>
                    <Stack direction="row" spacing={1.5}>
                      {[
                        {
                          href: 'https://www.linkedin.com/company/pineappletapped',
                          icon: <LinkedInIcon fontSize="small" />, 
                        },
                        {
                          href: 'https://www.instagram.com/pineappletapped',
                          icon: <InstagramIcon fontSize="small" />, 
                        },
                        {
                          href: 'https://www.youtube.com/@pineappletapped7015',
                          icon: <YouTubeIcon fontSize="small" />, 
                        },
                        {
                          href: 'https://www.tiktok.com/@pineappletapped',
                          icon: <MusicNoteIcon fontSize="small" />, 
                        },
                      ].map(({ href, icon }) => (
                        <IconButton
                          key={href}
                          component="a"
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          size="small"
                          sx={{
                            bgcolor: 'secondary.main',
                            color: 'secondary.contrastText',
                            '&:hover': {
                              bgcolor: 'primary.main',
                            },
                          }}
                        >
                          {icon}
                        </IconButton>
                      ))}
                    </Stack>
                  </Stack>
                </Stack>
              </Container>
            </Box>
            <CookieBanner />
            <AnalyticsScripts />
            <AnalyticsTracker />
          </CartProvider>
        </PineappleThemeProvider>
      </body>
    </html>
  );
}
