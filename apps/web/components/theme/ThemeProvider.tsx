'use client';

import { ReactNode } from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v14-appRouter';
import { CssBaseline, ThemeProvider, createTheme, responsiveFontSizes } from '@mui/material';

const baseTheme = createTheme({
  palette: {
    primary: {
      main: '#E8793B',
      contrastText: '#fff',
    },
    secondary: {
      main: '#1E3A8A',
      contrastText: '#fff',
    },
    background: {
      default: '#F6F7FB',
      paper: '#FFFFFF',
    },
    text: {
      primary: '#1F2937',
      secondary: '#475569',
    },
  },
  shape: {
    borderRadius: 18,
  },
  typography: {
    fontFamily: '"Poppins", "Roboto", "Helvetica", "Arial", sans-serif',
    fontWeightMedium: 600,
    button: {
      textTransform: 'none',
      fontWeight: 600,
      borderRadius: 999,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: `
        :root {
          color-scheme: light;
        }
        body {
          background: radial-gradient(circle at top, rgba(255,240,229,0.6), transparent 55%),
            radial-gradient(circle at bottom, rgba(219,234,254,0.45), transparent 55%),
            #F6F7FB;
        }
      `,
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          borderRadius: 24,
          border: '1px solid rgba(15, 23, 42, 0.08)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: ({ ownerState, theme }) => ({
          borderRadius: 999,
          paddingInline: theme.spacing(2.5),
          paddingBlock: theme.spacing(1.25),
          ...(ownerState.variant === 'contained' && {
            boxShadow: '0 10px 30px -15px rgba(232, 121, 59, 0.6)',
          }),
        }),
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        },
      },
    },
  },
});

const theme = responsiveFontSizes(baseTheme);

export default function PineappleThemeProvider({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ key: 'mui' }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
