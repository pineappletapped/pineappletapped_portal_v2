'use client';

import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Avatar,
  Box,
  Chip,
  Container,
  Drawer,
  Grid,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import Diversity3OutlinedIcon from '@mui/icons-material/Diversity3Outlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import LayersOutlinedIcon from '@mui/icons-material/LayersOutlined';
import LocalMallOutlinedIcon from '@mui/icons-material/LocalMallOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import MailOutlineOutlinedIcon from '@mui/icons-material/MailOutlineOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import QueryStatsOutlinedIcon from '@mui/icons-material/QueryStatsOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import WorkOutlineOutlinedIcon from '@mui/icons-material/WorkOutlineOutlined';
import CloseIcon from '@mui/icons-material/Close';
import Breadcrumbs from './Breadcrumbs';
import { auth, ensureFirebase } from '@/lib/firebase';

type IconComponent = React.ElementType;

interface NavigationItem {
  label: string;
  href: string;
  icon: IconComponent;
  exact?: boolean;
}

interface NavigationSection {
  heading: string;
  items: NavigationItem[];
}

type QuickAction = {
  label: string;
  href: string;
  icon: IconComponent;
};

type PortalConfig = {
  id: string;
  match: (pathname: string) => boolean;
  badge: string;
  title: string;
  summary?: string;
  brandMark: string;
  sidebarTitle: string;
  sidebarSubtitle: string;
  sidebarCopy?: string;
  navigation?: NavigationSection[];
  quickActions?: QuickAction[];
  surface: 'card' | 'plain';
};

const CLIENT_SEGMENTS = [
  'dashboard',
  'projects',
  'orders',
  'bookings',
  'emails',
  'analytics',
  'orgs',
  'training',
  'tasks',
];

const isClientPath = (pathname: string) => {
  if (pathname === '/' || pathname === '') return true;
  return CLIENT_SEGMENTS.some((segment) =>
    pathname === `/${segment}` || pathname.startsWith(`/${segment}/`)
  );
};

const PORTAL_CONFIGS: PortalConfig[] = [
  {
    id: 'admin',
    match: (pathname) => pathname.startsWith('/admin'),
    badge: 'Admin workspace',
    title: 'Operations command centre',
    summary:
      'Coordinate production, monitor revenue, and keep every franchise aligned with Pineapple Tapped standards.',
    brandMark: 'PT',
    sidebarTitle: 'Pineapple Tapped',
    sidebarSubtitle: 'Admin Portal',
    sidebarCopy:
      'Steer fulfilment, tooling, and enablement initiatives for every client and franchise.',
    navigation: [
      {
        heading: 'Command',
        items: [
          { label: 'Overview', href: '/admin', icon: HomeOutlinedIcon, exact: true },
          { label: 'Projects', href: '/admin/projects', icon: FolderOutlinedIcon },
          { label: 'Orders', href: '/admin/orders', icon: LocalMallOutlinedIcon },
          { label: 'Bookings', href: '/admin/bookings', icon: CalendarMonthOutlinedIcon },
          { label: 'Deliveries', href: '/admin/deliveries', icon: CloudUploadOutlinedIcon },
          { label: 'Analytics', href: '/admin/analytics', icon: QueryStatsOutlinedIcon },
        ],
      },
      {
        heading: 'Enablement',
        items: [
          { label: 'Tools hub', href: '/admin/tools', icon: GridViewOutlinedIcon },
          { label: 'AI management', href: '/admin/ai-management', icon: SettingsOutlinedIcon },
          { label: 'Training', href: '/admin/training', icon: LayersOutlinedIcon },
          { label: 'Marketing', href: '/admin/marketing', icon: AssignmentOutlinedIcon },
          { label: 'Email templates', href: '/admin/email-templates', icon: MailOutlineOutlinedIcon },
        ],
      },
      {
        heading: 'People & coverage',
        items: [
          { label: 'Team', href: '/admin/team', icon: Diversity3OutlinedIcon },
          { label: 'Franchises', href: '/admin/franchises', icon: WorkOutlineOutlinedIcon },
          { label: 'Insurance', href: '/admin/insurance', icon: LockOutlinedIcon },
        ],
      },
    ],
    quickActions: [
      { label: 'Create proposal', href: '/admin/proposals', icon: AssignmentOutlinedIcon },
      { label: 'Schedule production', href: '/admin/bookings', icon: CalendarMonthOutlinedIcon },
      { label: 'Launch tools hub', href: '/admin/tools', icon: GridViewOutlinedIcon },
    ],
    surface: 'plain',
  },
  {
    id: 'client',
    match: isClientPath,
    badge: 'Client workspace',
    title: 'Your production hub',
    summary:
      'Track projects, approve deliverables, and connect with the Pineapple Tapped team in real time.',
    brandMark: 'PT',
    sidebarTitle: 'Pineapple Tapped',
    sidebarSubtitle: 'Client Portal',
    sidebarCopy:
      'Navigate the services, insights, and collaboration tools that keep your brand growing.',
    navigation: [
      {
        heading: 'Work',
        items: [
          { label: 'Dashboard', href: '/dashboard', icon: DashboardOutlinedIcon, exact: true },
          { label: 'Projects', href: '/projects', icon: FolderOutlinedIcon },
          { label: 'Bookings', href: '/bookings', icon: CalendarMonthOutlinedIcon },
        ],
      },
      {
        heading: 'Collaboration',
        items: [
          { label: 'Shared inbox', href: '/emails', icon: MailOutlineOutlinedIcon },
          { label: 'Analytics', href: '/analytics', icon: AssessmentOutlinedIcon },
          { label: 'Content planner', href: '/dashboard/content-planner', icon: GridViewOutlinedIcon },
          { label: 'Organisations', href: '/orgs', icon: Diversity3OutlinedIcon },
        ],
      },
    ],
    quickActions: [
      { label: 'Request new project', href: '/projects/new', icon: LayersOutlinedIcon },
      { label: 'Book a shoot', href: '/bookings', icon: CalendarMonthOutlinedIcon },
      { label: 'Open shared inbox', href: '/emails', icon: MailOutlineOutlinedIcon },
    ],
    surface: 'card',
  },
];

const DEFAULT_CONFIG: PortalConfig = {
  id: 'default',
  match: () => true,
  badge: 'Workspace',
  title: 'Portal overview',
  summary: 'Manage your Pineapple Tapped workflows and content in one place.',
  brandMark: 'PT',
  sidebarTitle: 'Pineapple Tapped',
  sidebarSubtitle: 'Portal',
  sidebarCopy: 'Switch between teams and toolsets tailored to your role.',
  navigation: [],
  quickActions: [],
  surface: 'card',
};

function isItemActive(pathname: string, item: NavigationItem): boolean {
  if (item.exact) {
    return pathname === item.href;
  }
  if (item.href === '/') {
    return pathname === '/';
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function resolvePortalConfig(pathname: string): PortalConfig {
  return PORTAL_CONFIGS.find((config) => config.match(pathname)) ?? DEFAULT_CONFIG;
}

function getUserInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  const initials = parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
  return initials || 'PT';
}

const drawerWidth = 304;

export default function PortalContainer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = useTheme();
  const isLgUp = useMediaQuery(theme.breakpoints.up('lg'));
  const portalConfig = useMemo(() => resolvePortalConfig(pathname), [pathname]);
  const navSections = useMemo(
    () => (portalConfig.navigation ?? []).filter((section) => section.items.length > 0),
    [portalConfig.navigation]
  );
  const disableNavigation = portalConfig.id === 'admin';
  const hasNavigation = !disableNavigation && navSections.length > 0;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [userName, setUserName] = useState<string>('Workspace member');
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        await ensureFirebase();
        if (auth && typeof auth.onAuthStateChanged === 'function') {
          unsubscribe = auth.onAuthStateChanged((user: User | null) => {
            if (user) {
              setUserName(user.displayName || 'Workspace member');
              setUserEmail(user.email || null);
            } else {
              setUserName('Workspace member');
              setUserEmail(null);
            }
          });
        }
      } catch (error) {
        console.error('PortalContainer failed to load auth state', error);
      }
    })();
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const navContent = hasNavigation ? (
    <Box
      role="navigation"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ px: 3, py: 4, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar
            variant="rounded"
            sx={{
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              fontWeight: 600,
              width: 52,
              height: 52,
              fontSize: 20,
            }}
          >
            {portalConfig.brandMark}
          </Avatar>
          <Box>
            <Typography variant="overline" color="secondary.main" sx={{ letterSpacing: '0.28em' }}>
              {portalConfig.sidebarTitle}
            </Typography>
            <Typography variant="h6" color="text.primary">
              {portalConfig.sidebarSubtitle}
            </Typography>
          </Box>
        </Stack>
        {portalConfig.sidebarCopy ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {portalConfig.sidebarCopy}
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, py: 4 }}>
        <Stack spacing={4}>
          {navSections.map((section) => (
            <Box key={section.heading}>
              <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5, letterSpacing: '0.08em' }}>
                {section.heading}
              </Typography>
              <List disablePadding>
                {section.items.map((item) => {
                  const ItemIcon = item.icon;
                  const active = isItemActive(pathname, item);
                  return (
                    <ListItemButton
                      key={item.href}
                      component={NextLink}
                      href={item.href}
                      selected={active}
                      onClick={() => setMobileNavOpen(false)}
                      sx={{
                        borderRadius: 2,
                        mb: 0.5,
                        '&.Mui-selected': {
                          bgcolor: 'primary.main',
                          color: 'primary.contrastText',
                          '& .MuiListItemIcon-root': {
                            color: 'inherit',
                          },
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 36, color: 'text.secondary' }}>
                        <ItemIcon fontSize="small" />
                      </ListItemIcon>
                      <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight: active ? 600 : 500 }} />
                    </ListItemButton>
                  );
                })}
              </List>
            </Box>
          ))}
        </Stack>
      </Box>
    </Box>
  ) : null;

  const quickActions = portalConfig.quickActions ?? [];

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', py: { xs: 4, md: 6 } }}>
      <Container maxWidth="xl" sx={{ display: 'flex', gap: 4 }}>
        {hasNavigation && isLgUp ? (
          <Box component="aside" sx={{ width: drawerWidth, flexShrink: 0 }}>
            <Paper sx={{ height: '100%', overflow: 'hidden' }}>{navContent}</Paper>
          </Box>
        ) : null}
        <Box component="main" sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ display: { lg: 'none' } }}>
            {hasNavigation ? (
              <IconButton
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
                sx={{ border: '1px solid', borderColor: 'divider' }}
              >
                <MenuIcon />
              </IconButton>
            ) : (
              <Box />
            )}
          </Stack>

          <Paper sx={{ p: { xs: 3, md: 4 }, position: 'relative', overflow: 'hidden' }}>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={4} justifyContent="space-between" alignItems="flex-start">
              <Box>
                <Chip label={portalConfig.badge} color="secondary" size="small" sx={{ mb: 2 }} />
                <Typography variant="h4" color="text.primary" gutterBottom>
                  {portalConfig.title}
                </Typography>
                {portalConfig.summary ? (
                  <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 640 }}>
                    {portalConfig.summary}
                  </Typography>
                ) : null}
              </Box>
              <Paper
                variant="outlined"
                sx={{
                  borderRadius: 3,
                  px: 3,
                  py: 2.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  boxShadow: 'inset 0 1px 0 rgba(15,23,42,0.06)',
                  minWidth: 220,
                }}
              >
                <Avatar sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 600 }}>
                  {getUserInitials(userName)}
                </Avatar>
                <Box>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {userName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {userEmail ?? 'Signed in'}
                  </Typography>
                </Box>
              </Paper>
            </Stack>
            {quickActions.length > 0 ? (
              <Grid container spacing={2} sx={{ mt: 3 }}>
                {quickActions.map((action) => {
                  const ActionIcon = action.icon;
                  return (
                    <Grid item xs={12} sm={6} lg={4} key={action.href}>
                      <Paper
                        component={NextLink}
                        href={action.href}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          px: 3,
                          py: 2.5,
                          textDecoration: 'none',
                          color: 'text.primary',
                          borderRadius: 3,
                          transition: 'all 0.2s ease',
                          '&:hover': {
                            borderColor: 'primary.main',
                            color: 'primary.main',
                            transform: 'translateY(-2px)',
                          },
                        }}
                      >
                        <Typography variant="body1" fontWeight={600}>
                          {action.label}
                        </Typography>
                        <ActionIcon fontSize="small" />
                      </Paper>
                    </Grid>
                  );
                })}
              </Grid>
            ) : null}
          </Paper>

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}
          >
            <Breadcrumbs />
            {portalConfig.surface === 'card' ? (
              <Paper sx={{ p: { xs: 3, md: 4 }, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {children}
              </Paper>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>{children}</Box>
            )}
          </Box>
        </Box>
      </Container>

      {hasNavigation ? (
        <Drawer
          anchor="left"
          variant="temporary"
          open={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', lg: 'none' },
            '& .MuiDrawer-paper': {
              width: drawerWidth,
              borderRadius: 0,
            },
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', px: 2, py: 1 }}>
            <IconButton onClick={() => setMobileNavOpen(false)} aria-label="Close navigation">
              <CloseIcon />
            </IconButton>
          </Box>
          {navContent}
        </Drawer>
      ) : null}
    </Box>
  );
}
