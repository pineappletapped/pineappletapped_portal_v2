'use client';

import { useEffect, useMemo, useState } from 'react';
import NextLink from 'next/link';
import {
  Alert,
  Box,
  Breadcrumbs as MUIBreadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Link as MUILink,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { summariseKitItems, type KitSummary } from '@/lib/kit-summary';
import CallSheetBuilder, {
  type ProjectBookingRecordLike,
  type ProjectLikeRecord,
  type StaffOptionLike,
} from '@/components/admin/projects/CallSheetBuilder';
import { ensureFirebase } from '@/lib/firebase';
import { useRoleGate } from '@/hooks/useRoleGate';
import { adminListUsers } from '@/lib/admin';
import { extractUserRoles, type UserRoles } from '@/lib/roles';

type ProjectTaskRecord = {
  id: string;
  title: string;
  status: string;
  dueDate: Date | null;
  assignee?: string | null;
  ownerName?: string | null;
  completed?: boolean;
};

type ProjectTimelineEntry = {
  id: string;
  label: string;
  timestamp: Date | null;
  actor?: string | null;
  kind: string;
};

const coerceDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'object') {
    const candidate = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof candidate.toDate === 'function') {
      try {
        return candidate.toDate();
      } catch (err) {
        console.warn('Failed to coerce Firestore timestamp via toDate', err);
      }
    }
    if (typeof candidate.seconds === 'number' && typeof candidate.nanoseconds === 'number') {
      return new Date(candidate.seconds * 1000 + Math.floor(candidate.nanoseconds / 1_000_000));
    }
  }
  return null;
};

const formatDate = (value: unknown, fallback = '—') => {
  const date = coerceDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const formatDateTime = (value: unknown, fallback = '—') => {
  const date = coerceDate(value);
  if (!date) return fallback;
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const parseBookingDocument = (snapshot: { id: string; data: () => any }): ProjectBookingRecordLike => {
  const raw = (snapshot.data() as Record<string, any>) ?? {};
  const slots = Array.isArray(raw.slots)
    ? raw.slots
        .map((slot: any, index: number) => {
          if (!slot || typeof slot !== 'object') return null;
          const id = typeof slot.id === 'string' && slot.id.trim().length > 0 ? slot.id.trim() : `${snapshot.id}-slot-${index + 1}`;
          const label = typeof slot.label === 'string' && slot.label.trim().length > 0 ? slot.label.trim() : `Slot ${index + 1}`;
          return {
            id,
            label,
            startAt: typeof slot.startAt === 'string' ? slot.startAt : null,
            endAt: typeof slot.endAt === 'string' ? slot.endAt : null,
            notes: typeof slot.notes === 'string' ? slot.notes : null,
          };
        })
        .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot))
    : [];

  return {
    id: snapshot.id,
    taskTitle: typeof raw.taskTitle === 'string' && raw.taskTitle.trim().length > 0 ? raw.taskTitle.trim() : 'Booking form',
    introduction: typeof raw.introduction === 'string' ? raw.introduction : null,
    slots,
  } satisfies ProjectBookingRecordLike;
};

const parseTaskDocument = (snapshot: { id: string; data: () => any }): ProjectTaskRecord => {
  const raw = (snapshot.data() as Record<string, any>) ?? {};
  return {
    id: snapshot.id,
    title: typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title.trim() : 'Untitled task',
    status: typeof raw.status === 'string' && raw.status.trim().length > 0 ? raw.status.trim() : 'pending',
    dueDate: coerceDate(raw.dueDate),
    assignee: typeof raw.assignee === 'string' ? raw.assignee : raw.assigneeId ?? null,
    ownerName: typeof raw.assigneeName === 'string' ? raw.assigneeName : raw.assigneeLabel ?? null,
    completed: Boolean(raw.completed),
  } satisfies ProjectTaskRecord;
};

const parseTimelineDocument = (snapshot: { id: string; data: () => any }): ProjectTimelineEntry => {
  const raw = (snapshot.data() as Record<string, any>) ?? {};
  return {
    id: snapshot.id,
    label: typeof raw.label === 'string' ? raw.label : raw.message || 'Timeline entry',
    timestamp: coerceDate(raw.timestamp) || coerceDate(raw.createdAt),
    actor: typeof raw.actor === 'string' ? raw.actor : raw.actorName || null,
    kind: typeof raw.kind === 'string' ? raw.kind : 'event',
  } satisfies ProjectTimelineEntry;
};

const statusColor = (status: string | null | undefined): 'default' | 'success' | 'warning' | 'info' | 'error' => {
  if (!status) return 'default';
  const normalised = status.toLowerCase();
  if (['completed', 'complete', 'delivered', 'fulfilled'].includes(normalised)) {
    return 'success';
  }
  if (['in_progress', 'in progress', 'active', 'production'].includes(normalised)) {
    return 'info';
  }
  if (['delayed', 'blocked'].includes(normalised)) {
    return 'error';
  }
  if (['pending', 'awaiting_input', 'awaiting input'].includes(normalised)) {
    return 'warning';
  }
  return 'default';
};

export default function AdminProjectDetailPage({ params }: { params: { id: string } }) {
  const projectId = params.id;
  const { allowed, loading: guardLoading } = useRoleGate(['admin', 'projects']);
  const [project, setProject] = useState<ProjectLikeRecord | null>(null);
  const [tasks, setTasks] = useState<ProjectTaskRecord[]>([]);
  const [bookings, setBookings] = useState<ProjectBookingRecordLike[]>([]);
  const [timeline, setTimeline] = useState<ProjectTimelineEntry[]>([]);
  const [kitSummary, setKitSummary] = useState<KitSummary | null>(null);
  const [staffOptions, setStaffOptions] = useState<StaffOptionLike[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callSheetOpen, setCallSheetOpen] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      if (guardLoading || !allowed) return;
      try {
        setLoading(true);
        setError(null);
        const { db } = await ensureFirebase();
        if (!db) {
          throw new Error('Firestore is unavailable');
        }

        const projectSnap = await getDoc(doc(db, 'projects', projectId));
        if (!projectSnap.exists()) {
          if (active) {
            setError('Project not found');
            setProject(null);
            setTasks([]);
            setBookings([]);
            setTimeline([]);
            setKitSummary(null);
          }
          return;
        }

        const projectData = {
          id: projectSnap.id,
          ...(projectSnap.data() as Record<string, any>),
        } as ProjectLikeRecord;

        const [tasksSnap, bookingsSnap, timelineSnap, orderSnap] = await Promise.all([
          getDocs(collection(db, 'projects', projectId, 'tasks')),
          getDocs(collection(db, 'projects', projectId, 'projectBookings')),
          getDocs(collection(db, 'projects', projectId, 'timeline')),
          typeof (projectData as any).orderId === 'string' && (projectData as any).orderId.trim().length > 0
            ? getDoc(doc(db, 'orders', (projectData as any).orderId.trim()))
            : Promise.resolve(null),
        ]);

        if (!active) return;

        setProject(projectData);
        setTasks(
          tasksSnap.docs
            .map((docSnap) => parseTaskDocument(docSnap))
            .sort((a, b) => {
              const left = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
              const right = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
              if (left === right) return a.title.localeCompare(b.title);
              return left - right;
            }),
        );
        setBookings(bookingsSnap.docs.map((docSnap) => parseBookingDocument(docSnap)));
        setTimeline(
          timelineSnap.docs
            .map((docSnap) => parseTimelineDocument(docSnap))
            .sort((a, b) => {
              const left = a.timestamp?.getTime() ?? 0;
              const right = b.timestamp?.getTime() ?? 0;
              return right - left;
            }),
        );

        if (orderSnap && 'exists' in orderSnap && orderSnap?.exists()) {
          const orderData = orderSnap.data() as Record<string, any>;
          const summary = summariseKitItems(orderData?.kitItems ?? []);
          setKitSummary(summary ?? null);
        } else {
          setKitSummary(null);
        }
      } catch (err) {
        console.error('Failed to load project detail', err);
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load project');
          setProject(null);
          setTasks([]);
          setBookings([]);
          setTimeline([]);
          setKitSummary(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [allowed, guardLoading, projectId]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        await ensureFirebase();
        const result: any = await adminListUsers();
        if (!active) return;
        const options = ((result?.users as any[]) || [])
          .reduce<StaffOptionLike[]>((acc, user: any) => {
            const roles = extractUserRoles(user as { roles?: UserRoles; isStaff?: boolean });
            if (
              roles.admin ||
              roles.sales ||
              roles.operations ||
              roles.projects ||
              roles.marketing ||
              roles.finance
            ) {
              acc.push({
                uid: (user.id as string) || (user.uid as string),
                label:
                  user.fullName ||
                  user.displayName ||
                  user.name ||
                  user.email ||
                  'Unnamed user',
                email: user.email || null,
                phoneNumber: user.phoneNumber || null,
              });
            }
            return acc;
          }, [])
          .sort((a, b) => a.label.localeCompare(b.label));
        setStaffOptions(options);
      } catch (err) {
        console.error('Failed to load staff directory', err);
        if (active) {
          setStaffOptions([]);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const projectStatus = ((project as any)?.status as string | undefined) ?? 'Pending';
  const statusChipColor = statusColor((project as any)?.status);
  const priorityChip = project && (project as any).priority ? (project as any).priority : null;
  const ownerName = (project as any)?.ownerName || (project as any)?.ownerDisplayName || (project as any)?.ownerEmail;
  const organisationName = (project as any)?.orgName || (project as any)?.organisationName || 'Unassigned organisation';

  const openCallSheet = () => setCallSheetOpen(true);
  const closeCallSheet = () => setCallSheetOpen(false);

  const kitLabel = useMemo(() => {
    if (!kitSummary) return null;
    const parts = [kitSummary.label];
    if (kitSummary.window) {
      parts.push(`Window: ${kitSummary.window}`);
    }
    if (kitSummary.hasDrone) {
      parts.push('Includes drone kit');
    }
    return parts.join(' • ');
  }, [kitSummary]);

  if (guardLoading || loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!allowed) {
    return (
      <Alert severity="warning" sx={{ borderRadius: 3 }}>
        You do not have permission to view this project workspace.
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ borderRadius: 3 }}>
        {error}
      </Alert>
    );
  }

  if (!project) {
    return (
      <Alert severity="info" sx={{ borderRadius: 3 }}>
        The requested project could not be found.
      </Alert>
    );
  }

  return (
    <Stack spacing={3} pb={{ xs: 4, md: 6 }}>
      <MUIBreadcrumbs aria-label="breadcrumb">
        <MUILink component={NextLink} href="/admin/projects" underline="hover" color="inherit">
          Projects
        </MUILink>
        <Typography color="text.primary">{project.title || (project as any).name || 'Project details'}</Typography>
      </MUIBreadcrumbs>

      <Paper sx={{ p: { xs: 3, md: 4 }, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ md: 'flex-start' }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.2em' }}>
              Project overview
            </Typography>
            <Typography variant="h4" color="text.primary" sx={{ mt: 1 }}>
              {project.title || (project as any).name || 'Untitled project'}
            </Typography>
            {project.summary || (project as any).projectOverview ? (
              <Typography variant="body1" color="text.secondary" sx={{ mt: 1.5, maxWidth: 720 }}>
                {(project as any).summary || (project as any).projectOverview}
              </Typography>
            ) : null}
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="flex-end">
            <Chip label={projectStatus} color={statusChipColor} variant={statusChipColor === 'default' ? 'outlined' : 'filled'} />
            {priorityChip ? <Chip label={`Priority: ${String(priorityChip)}`} color="warning" variant="outlined" /> : null}
            {(project as any).stage ? <Chip label={(project as any).stage} variant="outlined" /> : null}
          </Stack>
        </Stack>

        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" color="text.secondary">
              Organisation
            </Typography>
            <Typography variant="body1" color="text.primary">
              {organisationName}
            </Typography>
            {(project as any).orgId ? (
              <Typography variant="caption" color="text.secondary">
                ID: {(project as any).orgId}
              </Typography>
            ) : null}
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" color="text.secondary">
              Owner
            </Typography>
            <Typography variant="body1" color="text.primary">
              {ownerName || 'Unassigned'}
            </Typography>
            {(project as any).ownerEmail ? (
              <Typography variant="caption" color="text.secondary">
                {(project as any).ownerEmail}
              </Typography>
            ) : null}
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" color="text.secondary">
              Due / shoot date
            </Typography>
            <Typography variant="body1" color="text.primary">
              {formatDate((project as any).dueDate)}
            </Typography>
            {(project as any).kickoffDate ? (
              <Typography variant="caption" color="text.secondary">
                Kick-off: {formatDate((project as any).kickoffDate)}
              </Typography>
            ) : null}
          </Grid>
        </Grid>

        <Divider />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between">
          <Stack direction="row" spacing={1}>
            <Button variant="contained" color="primary" onClick={openCallSheet}>
              Build call sheet
            </Button>
            <Button component={NextLink} href="/admin/projects" variant="outlined">
              Back to projects
            </Button>
          </Stack>
          {kitLabel ? (
            <Chip label={kitLabel} color="info" variant="outlined" sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }} />
          ) : null}
        </Stack>
      </Paper>

      <Paper id="bookings" sx={{ p: { xs: 3, md: 4 }, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ sm: 'flex-end' }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.2em' }}>
              Booking forms
            </Typography>
            <Typography variant="h5" color="text.primary">
              Interviews & sign-ups
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {bookings.length === 0 ? 'No booking forms available' : `${bookings.length} booking ${bookings.length === 1 ? 'form' : 'forms'}`}
          </Typography>
        </Stack>

        {bookings.length === 0 ? (
          <Alert severity="info" sx={{ borderRadius: 3 }}>
            No booking forms have been configured for this project yet.
          </Alert>
        ) : (
          <Grid container spacing={2}>
            {bookings.map((booking) => {
              const windowLabel = booking.slots
                .map((slot) => {
                  if (slot.startAt && slot.endAt) {
                    return `${formatDateTime(slot.startAt)} – ${formatDateTime(slot.endAt)}`;
                  }
                  if (slot.startAt) {
                    return `${formatDateTime(slot.startAt)} onwards`;
                  }
                  if (slot.endAt) {
                    return `Ends ${formatDateTime(slot.endAt)}`;
                  }
                  return slot.label;
                })
                .filter(Boolean)
                .join(', ');

              return (
                <Grid item xs={12} md={6} key={booking.id}>
                  <Card variant="outlined" sx={{ borderRadius: 3, height: '100%' }}>
                    <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                      <Typography variant="subtitle1" fontWeight={600}>
                        {booking.taskTitle}
                      </Typography>
                      {booking.introduction ? (
                        <Typography variant="body2" color="text.secondary">
                          {booking.introduction}
                        </Typography>
                      ) : null}
                      {windowLabel ? (
                        <Typography variant="caption" color="text.secondary">
                          {windowLabel}
                        </Typography>
                      ) : null}
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        )}
      </Paper>

      <Paper id="tasks" sx={{ p: { xs: 3, md: 4 }, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ sm: 'flex-end' }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.2em' }}>
              Tasks & milestones
            </Typography>
            <Typography variant="h5" color="text.primary">
              Production checklist
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {tasks.length === 0 ? 'No tasks recorded' : `${tasks.length} task${tasks.length === 1 ? '' : 's'}`}
          </Typography>
        </Stack>

        {tasks.length === 0 ? (
          <Alert severity="info" sx={{ borderRadius: 3 }}>
            No project tasks have been captured yet. Add tasks from the admin project dashboard to track progress.
          </Alert>
        ) : (
          <Stack spacing={1.5}>
            {tasks.map((task) => (
              <Card key={task.id} variant="outlined" sx={{ borderRadius: 3 }}>
                <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ md: 'center' }}>
                    <Typography variant="subtitle1" fontWeight={600}>
                      {task.title}
                    </Typography>
                    <Chip
                      label={task.completed ? 'Completed' : task.status}
                      color={task.completed ? 'success' : statusColor(task.status)}
                      variant={task.completed ? 'filled' : 'outlined'}
                      size="small"
                    />
                  </Stack>
                  <Grid container spacing={1}>
                    <Grid item xs={12} md={4}>
                      <Typography variant="caption" color="text.secondary">
                        Assignee
                      </Typography>
                      <Typography variant="body2" color="text.primary">
                        {task.ownerName || task.assignee || 'Unassigned'}
                      </Typography>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <Typography variant="caption" color="text.secondary">
                        Due date
                      </Typography>
                      <Typography variant="body2" color="text.primary">
                        {task.dueDate ? formatDate(task.dueDate) : 'No due date'}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Paper>

      <Paper sx={{ p: { xs: 3, md: 4 }, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ sm: 'flex-end' }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.2em' }}>
              Activity timeline
            </Typography>
            <Typography variant="h5" color="text.primary">
              Latest updates
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {timeline.length === 0 ? 'No recent activity' : `${timeline.length} update${timeline.length === 1 ? '' : 's'}`}
          </Typography>
        </Stack>

        {timeline.length === 0 ? (
          <Alert severity="info" sx={{ borderRadius: 3 }}>
            No activity has been recorded for this project yet.
          </Alert>
        ) : (
          <Stack spacing={1.5}>
            {timeline.map((entry) => (
              <Card key={entry.id} variant="outlined" sx={{ borderRadius: 3 }}>
                <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Typography variant="subtitle2" color="text.primary">
                    {entry.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDateTime(entry.timestamp)}
                    {entry.actor ? ` • ${entry.actor}` : ''}
                  </Typography>
                  <Chip label={entry.kind} size="small" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Paper>

      {callSheetOpen && (
        <CallSheetBuilder
          project={project}
          kitSummary={kitSummary}
          bookings={bookings}
          staffOptions={staffOptions}
          onClose={closeCallSheet}
        />
      )}
    </Stack>
  );
}
