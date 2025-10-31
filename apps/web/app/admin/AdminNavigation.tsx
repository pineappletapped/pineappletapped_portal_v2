"use client";

import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { Box, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import type { AdminNavSection } from './navConfig';

interface AdminNavigationProps {
  sections: AdminNavSection[];
}

const matchPath = (pathname: string | null, href: string, exact?: boolean) => {
  if (!pathname) {
    return false;
  }
  if (exact) {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

export default function AdminNavigation({ sections }: AdminNavigationProps) {
  const pathname = usePathname();

  return (
    <Stack component="nav" spacing={4} aria-label="Admin sections">
      {sections.map((section) => (
        <Box key={section.title}>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ letterSpacing: '0.18em', display: 'block', mb: 1.5 }}
          >
            {section.title}
          </Typography>
          <List disablePadding>
            {section.items.map((item) => {
              const active = matchPath(pathname, item.href, item.exact);
              return (
                <ListItemButton
                  key={item.href}
                  component={NextLink}
                  href={item.href}
                  selected={active}
                  sx={{
                    borderRadius: 2,
                    mb: 0.5,
                    px: 1.5,
                    py: 1.25,
                    '&.Mui-selected': {
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      '&:hover': {
                        bgcolor: 'primary.main',
                      },
                    },
                  }}
                >
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{ fontWeight: active ? 600 : 500 }}
                  />
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      ))}
    </Stack>
  );
}
