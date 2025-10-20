'use client';

import type { ReactNode } from 'react';
import { Box, Paper, Stack, Typography } from '@mui/material';
import PortalContainer from '@/components/PortalContainer';

export interface AdminWorkspaceLayoutProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  hero?: ReactNode;
  children: ReactNode;
  headerAdornment?: ReactNode;
  inset?: boolean;
}

type SectionTone = 'default' | 'info' | 'danger' | 'success' | 'muted';

const tonePalette: Record<SectionTone, { border: string; background: string }> = {
  default: { border: 'rgba(15,23,42,0.1)', background: '#FFFFFF' },
  info: { border: 'rgba(30,58,138,0.25)', background: 'rgba(219,234,254,0.55)' },
  danger: { border: 'rgba(225,29,72,0.25)', background: 'rgba(254,226,226,0.8)' },
  success: { border: 'rgba(16,185,129,0.25)', background: 'rgba(209,250,229,0.75)' },
  muted: { border: 'rgba(148,163,184,0.32)', background: 'rgba(248,250,252,0.9)' },
};

export default function AdminWorkspaceLayout({
  title,
  description,
  actions,
  hero,
  children,
  headerAdornment,
  inset = false,
}: AdminWorkspaceLayoutProps) {
  return (
    <PortalContainer>
      <Stack spacing={5} sx={{ px: inset ? { lg: 2, xl: 3 } : 0 }}>
        <Paper sx={{ p: { xs: 3, md: 4 } }}>
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3} justifyContent="space-between" alignItems={{ lg: 'flex-end' }}>
            <Box>
              <Typography variant="overline" color="secondary.main" sx={{ letterSpacing: '0.32em' }}>
                Admin workspace
              </Typography>
              <Typography variant="h4" color="text.primary" sx={{ mt: 1 }}>
                {title}
              </Typography>
              {description ? (
                <Box sx={{ mt: 1.5, color: 'text.secondary', '& > p': { mt: 1, mb: 0 } }}>{description}</Box>
              ) : null}
            </Box>
            {actions ? <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>{actions}</Box> : null}
          </Stack>
          {headerAdornment ? <Box sx={{ mt: 3 }}>{headerAdornment}</Box> : null}
        </Paper>
        {hero ? (
          <Paper
            sx={{
              p: { xs: 3, md: 4 },
              background: 'linear-gradient(135deg, rgba(232,121,59,0.15), rgba(30,58,138,0.12))',
              borderColor: 'rgba(232,121,59,0.35)',
            }}
          >
            {hero}
          </Paper>
        ) : null}
        <Stack spacing={3}>{children}</Stack>
      </Stack>
    </PortalContainer>
  );
}

export function AdminSection({
  title,
  description,
  children,
  footer,
  tone = 'default',
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  tone?: SectionTone;
}) {
  const palette = tonePalette[tone] ?? tonePalette.default;

  return (
    <Paper
      sx={{
        p: { xs: 3, md: 4 },
        borderRadius: 4,
        borderColor: palette.border,
        background: palette.background,
        boxShadow: '0 15px 35px -30px rgba(15,23,42,0.35)',
        '&:hover': {
          boxShadow: '0 20px 40px -28px rgba(15,23,42,0.38)',
        },
      }}
    >
      <Stack spacing={3}>
        {title ? (
          <Box>
            <Typography variant="h6" color="text.primary">
              {title}
            </Typography>
            {description ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {description}
              </Typography>
            ) : null}
          </Box>
        ) : null}
        <Stack spacing={3}>{children}</Stack>
        {footer ? (
          <Box sx={{ pt: 2, borderTop: '1px solid rgba(148,163,184,0.35)', color: 'text.secondary', fontSize: 14 }}>
            {footer}
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}
