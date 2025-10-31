import type { ReactNode } from 'react';
import { Box, Chip, Container, Paper, Stack, Typography } from '@mui/material';
import AdminNavigation from './AdminNavigation';
import { ADMIN_NAV_SECTIONS } from './navConfig';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ bgcolor: 'grey.50', py: { xs: 3, md: 4 } }}>
      <Container
        maxWidth="xl"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', lg: 'row' },
          gap: { xs: 3, md: 4 },
          alignItems: 'stretch',
        }}
      >
        <Box component="aside" sx={{ width: { lg: 288 }, flexShrink: 0 }}>
          <Paper
            elevation={0}
            sx={{
              borderRadius: 4,
              border: '1px solid',
              borderColor: 'divider',
              p: { xs: 2.5, md: 3 },
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              height: '100%',
            }}
          >
            <Stack spacing={1.5}>
              <Chip label="Admin workspace" color="secondary" size="small" sx={{ alignSelf: 'flex-start' }} />
              <Box>
                <Typography variant="h5" color="text.primary">
                  Control centre
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                  Navigate the tools that keep bookings, production, and franchise operations running smoothly.
                </Typography>
              </Box>
            </Stack>
            <AdminNavigation sections={ADMIN_NAV_SECTIONS} />
          </Paper>
        </Box>
        <Box component="main" sx={{ flex: 1, minWidth: 0 }}>
          <Stack spacing={3} pb={{ xs: 4, md: 6 }}>
            {children}
          </Stack>
        </Box>
      </Container>
    </Box>
  );
}
