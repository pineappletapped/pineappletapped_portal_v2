"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { auth, db, ensureFirebase, functions, httpsCallable } from '@/lib/firebase';
import {
  collection,
  getDoc,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { extractUserRoles, hasRole } from '@/lib/roles';
import PortalContainer from '@/components/PortalContainer';

type PaymentMode = 'deposit_balance' | 'balance_on_completion';

interface OfferFormState {
  role: string;
  targetType: 'hq' | 'franchise';
  targetFranchiseId: string;
  targetUserId: string;
  totalAmount: string;
  depositAmount: string;
  paymentMode: PaymentMode;
  currency: string;
  notes: string;
}

interface CounterFormState {
  taskId: string | null;
  totalAmount: string;
  depositAmount: string;
  paymentMode: PaymentMode;
  currency: string;
  notes: string;
}

interface TaskComment {
  id: string;
  body: string;
  uid?: string | null;
  userName?: string | null;
  createdAt?: Timestamp | Date | string | null;
}

interface UserContextState {
  uid: string | null;
  franchiseIds: string[];
  canManage: boolean;
  canOutsource: boolean;
  isHq: boolean;
}

const OFFER_FORM_DEFAULTS: OfferFormState = {
  role: '',
  targetType: 'hq',
  targetFranchiseId: '',
  targetUserId: '',
  totalAmount: '',
  depositAmount: '',
  paymentMode: 'deposit_balance',
  currency: 'GBP',
  notes: '',
};

const COUNTER_FORM_DEFAULTS: CounterFormState = {
  taskId: null,
  totalAmount: '',
  depositAmount: '',
  paymentMode: 'deposit_balance',
  currency: 'GBP',
  notes: '',
};

const DETAIL_FORM_DEFAULT = {
  title: '',
  description: '',
  dueDate: '',
  assignedTo: '',
  status: 'todo',
};

function coerceTaskDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  if (value && typeof value === 'object' && typeof value.toDate === 'function') {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function toDateInputValue(value: any): string {
  const date = coerceTaskDate(value);
  if (!date) return '';
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    .toISOString()
    .slice(0, 10);
}

function formatTaskDateDisplay(value: any): string {
  const date = coerceTaskDate(value);
  if (!date) return '';
  return date.toLocaleDateString();
}

function formatCommentTimestamp(value: any): string {
  const date = coerceTaskDate(value);
  if (!date) return '';
  return date.toLocaleString();
}

/**
 * Project Tasks Board
 *
 * Provides a simple Kanban-like board to manage tasks for a project. Tasks are grouped
 * by status. Users can create tasks and change their status via dropdowns. Drag-and-drop
 * is not implemented but could be added later.
 */
export default function ProjectTasksPage() {
  const params = useParams();
  const projectId = params?.id as string;
  const [project, setProject] = useState<any | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [isStaffOrAdmin, setIsStaffOrAdmin] = useState<boolean | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [franchises, setFranchises] = useState<any[]>([]);
  const [userContext, setUserContext] = useState<UserContextState>({
    uid: null,
    franchiseIds: [],
    canManage: false,
    canOutsource: false,
    isHq: false,
  });
  const [activeOfferTaskId, setActiveOfferTaskId] = useState<string | null>(null);
  const [offerForm, setOfferForm] = useState<OfferFormState>({ ...OFFER_FORM_DEFAULTS });
  const [offerSubmitting, setOfferSubmitting] = useState(false);
  const [actionState, setActionState] = useState<string | null>(null);
  const [counterState, setCounterState] = useState<CounterFormState>({ ...COUNTER_FORM_DEFAULTS });
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [detailForm, setDetailForm] = useState({ ...DETAIL_FORM_DEFAULT });
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailComments, setDetailComments] = useState<TaskComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newCommentBody, setNewCommentBody] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  const franchiseMap = useMemo(() => {
    const map = new Map<string, any>();
    franchises.forEach((item) => {
      if (item?.id) {
        map.set(item.id, item);
      }
    });
    return map;
  }, [franchises]);
  const membersMap = useMemo(() => {
    const map = new Map<string, string>();
    members.forEach((member: any) => {
      if (member?.uid) {
        map.set(member.uid, member.name || member.uid);
      }
    });
    return map;
  }, [members]);

  const formatCurrency = useCallback((value: unknown, currency?: string | null) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      return '';
    }
    const safeCurrency = currency && typeof currency === 'string' ? currency : 'GBP';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: safeCurrency }).format(numeric);
    } catch (err) {
      console.warn('Unable to format currency', err);
      return `${safeCurrency} ${numeric.toFixed(2)}`;
    }
  }, []);

  const formatMoney = useCallback(
    (amount: unknown, currency?: string | null) => {
      const formatted = formatCurrency(amount, currency);
      if (formatted) {
        return formatted;
      }
      if (typeof amount === 'number' && Number.isFinite(amount)) {
        return `${currency || 'GBP'} ${amount.toFixed(2)}`;
      }
      if (typeof amount === 'string' && amount.trim()) {
        return `${currency || 'GBP'} ${amount.trim()}`;
      }
      return '';
    },
    [formatCurrency]
  );

  const reloadTasks = useCallback(async () => {
    if (!projectId) return;
    const tSnap = await getDocs(
      query(collection(db, 'projects', projectId, 'tasks'), orderBy('createdAt', 'desc'))
    );
    setTasks(tSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, [projectId]);

  const loadTaskComments = useCallback(
    async (taskId: string) => {
      if (!projectId) return;
      setCommentsLoading(true);
      try {
        const snap = await getDocs(
          query(
            collection(db, 'projects', projectId, 'tasks', taskId, 'comments'),
            orderBy('createdAt', 'asc')
          )
        );
        const items: TaskComment[] = snap.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          return {
            id: docSnap.id,
            body: typeof data?.body === 'string' ? data.body : '',
            uid: typeof data?.uid === 'string' ? data.uid : null,
            userName: typeof data?.userName === 'string' ? data.userName : null,
            createdAt: data?.createdAt ?? null,
          };
        });
        setDetailComments(items);
      } catch (err) {
        console.error('Failed to load task comments', err);
      } finally {
        setCommentsLoading(false);
      }
    },
    [projectId]
  );

  const primaryActionClasses =
    'rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';
  const dangerActionClasses =
    'rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50';
  const secondaryActionClasses =
    'rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';

  // Load project and tasks
  useEffect(() => {
    let active = true;
    (async () => {
      if (!projectId) return;
      try {
        const projectSnap = await getDoc(doc(db, 'projects', projectId));
        if (!active) return;
        if (!projectSnap.exists()) {
          setProject(null);
          setTasks([]);
          setMembers([]);
          setIsStaffOrAdmin(false);
          setUserContext({ uid: null, franchiseIds: [], canManage: false, canOutsource: false, isHq: false });
          setLoading(false);
          return;
        }

        const proj = projectSnap.data() as any;
        setProject(proj);

        const user = auth.currentUser;
        if (!user) {
          setIsStaffOrAdmin(false);
          setUserContext({ uid: null, franchiseIds: [], canManage: false, canOutsource: false, isHq: false });
        } else {
          const userSnap = await getDoc(doc(db, 'users', user.uid));
          if (!active) return;
          const me = userSnap.data() as any;
          const roles = extractUserRoles(me);
          let canEdit = hasRole(roles, ['admin', 'projects']);
          if (proj?.orgId) {
            const membershipSnap = await getDoc(doc(db, 'memberships', `${proj.orgId}_${user.uid}`));
            if (!active) return;
            if (membershipSnap.exists()) {
              const membership = membershipSnap.data() as any;
              if (membership?.role === 'client_admin') {
                canEdit = true;
              }
            }
          }
          setIsStaffOrAdmin(canEdit);
          const franchiseIds = new Set<string>();
          if (typeof me?.primaryFranchiseId === 'string' && me.primaryFranchiseId.trim()) {
            franchiseIds.add(me.primaryFranchiseId.trim());
          }
          if (typeof me?.franchiseId === 'string' && me.franchiseId.trim()) {
            franchiseIds.add(me.franchiseId.trim());
          }
          if (Array.isArray(me?.franchiseIds)) {
            me.franchiseIds.forEach((value: unknown) => {
              if (typeof value === 'string' && value.trim()) {
                franchiseIds.add(value.trim());
              }
            });
          }
          setUserContext({
            uid: user.uid,
            franchiseIds: Array.from(franchiseIds),
            canManage: canEdit,
            canOutsource: canEdit || franchiseIds.size > 0,
            isHq: canEdit,
          });
        }

        await reloadTasks();
        if (!active) return;

        if (proj?.orgId) {
          const memSnap = await getDocs(query(collection(db, 'memberships'), where('orgId', '==', proj.orgId)));
          if (!active) return;
          const mems = memSnap.docs.map((d) => d.data() as any);
          const userSnaps = await Promise.all(mems.map((m) => getDoc(doc(db, 'users', m.userId))));
          if (!active) return;
          setMembers(
            mems.map((m, i) => {
              const userSnap = userSnaps[i];
              const data = userSnap.data() as any;
              return {
                uid: m.userId,
                name: data?.displayName || data?.email || 'Unnamed',
              };
            })
          );
        } else {
          setMembers([]);
        }
      } catch (err) {
        console.error('Failed to load project tasks', err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [projectId, reloadTasks]);

  useEffect(() => {
    if (!projectId || !userContext.canOutsource) return;
    let active = true;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'franchises'));
        if (!active) return;
        const items = snap.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          return {
            id: docSnap.id,
            name: data?.name || docSnap.id,
            code: data?.code || null,
          };
        });
        setFranchises(items);
      } catch (err) {
        console.error('Failed to load franchises', err);
      }
    })();

    return () => {
      active = false;
    };
  }, [projectId, userContext.canOutsource]);

  useEffect(() => {
    if (!detailTaskId) return;
    void loadTaskComments(detailTaskId);
  }, [detailTaskId, loadTaskComments]);

  const addTask = async () => {
    if (!title.trim()) { alert('Task title is required'); return; }
    if (!projectId) { alert('Project is unavailable.'); return; }
    try {
      // Create the task doc
      const taskRef = await addDoc(collection(db, 'projects', projectId, 'tasks'), {
        title: title.trim(),
        description: description.trim(),
        dueDate: dueDate || null,
        status: 'todo',
        createdAt: new Date().toISOString(),
        assignedTo: assignedTo || null,
        assigneeName: members.find((m) => m.uid === assignedTo)?.name || null,
      });
      // Record audit trail for creation
      const user = auth.currentUser;
      await addDoc(collection(db, 'taskHistory'), {
        projectId,
        taskId: taskRef.id,
        action: 'create',
        fromStatus: null,
        toStatus: 'todo',
        uid: user ? user.uid : null,
        createdAt: serverTimestamp(),
      });
      await reloadTasks();
      setTitle('');
      setDescription('');
      setDueDate('');
      setAssignedTo('');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error creating task');
    }
  };

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
    if (!projectId) { alert('Project is unavailable.'); return; }
    try {
      // Read current status to record history
      const current = tasks.find((t) => t.id === taskId);
      const fromStatus = current?.status || null;
      await updateDoc(doc(db, 'projects', projectId, 'tasks', taskId), { status: newStatus });
      // Record audit history
      const user = auth.currentUser;
      await addDoc(collection(db, 'taskHistory'), {
        projectId,
        taskId,
        action: 'update_status',
        fromStatus,
        toStatus: newStatus,
        uid: user ? user.uid : null,
        createdAt: serverTimestamp(),
      });
      await reloadTasks();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating task');
    }
  };

  const updateTaskAssignee = async (taskId: string, uid: string) => {
    if (!projectId) { alert('Project is unavailable.'); return; }
    try {
      const member = members.find((m) => m.uid === uid);
      await updateDoc(doc(db, 'projects', projectId, 'tasks', taskId), {
        assignedTo: uid || null,
        assigneeName: member?.name || null,
      });
      await reloadTasks();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error assigning task');
    }
  };

  const openOfferForm = (taskId: string) => {
    setActiveOfferTaskId(taskId);
    setOfferForm({ ...OFFER_FORM_DEFAULTS });
  };

  const closeOfferForm = () => {
    setActiveOfferTaskId(null);
    setOfferForm({ ...OFFER_FORM_DEFAULTS });
  };

  const openTaskDetails = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    setDetailTaskId(taskId);
    setDetailForm({
      title: typeof task.title === 'string' ? task.title : '',
      description: typeof task.description === 'string' ? task.description : '',
      dueDate: toDateInputValue(task.dueDate),
      assignedTo: typeof task.assignedTo === 'string' ? task.assignedTo : '',
      status: typeof task.status === 'string' ? task.status : 'todo',
    });
    setDetailError(null);
    setCommentError(null);
    setNewCommentBody('');
    void loadTaskComments(taskId);
  };

  const closeTaskDetails = () => {
    setDetailTaskId(null);
    setDetailForm({ ...DETAIL_FORM_DEFAULT });
    setDetailError(null);
    setCommentError(null);
    setDetailComments([]);
    setNewCommentBody('');
  };

  const saveTaskDetails = async () => {
    if (!projectId || !detailTaskId) return;
    const trimmedTitle = detailForm.title.trim();
    if (!trimmedTitle) {
      setDetailError('Task title is required.');
      return;
    }
    const currentTask = tasks.find((t) => t.id === detailTaskId);
    const statusBefore = typeof currentTask?.status === 'string' ? currentTask!.status : 'todo';
    const statusChanged = detailForm.status !== statusBefore;
    const assignee = detailForm.assignedTo
      ? membersMap.get(detailForm.assignedTo) || null
      : null;
    setDetailSaving(true);
    try {
      await updateDoc(doc(db, 'projects', projectId, 'tasks', detailTaskId), {
        title: trimmedTitle,
        description: detailForm.description.trim() || '',
        dueDate: detailForm.dueDate || null,
        assignedTo: detailForm.assignedTo || null,
        assigneeName: assignee,
      });
      if (statusChanged) {
        await updateTaskStatus(detailTaskId, detailForm.status);
      } else {
        await reloadTasks();
      }
      setDetailError(null);
    } catch (err) {
      console.error('Failed to save task details', err);
      setDetailError('Failed to save changes. Please try again.');
    } finally {
      setDetailSaving(false);
    }
  };

  const submitComment = async () => {
    if (!projectId || !detailTaskId) return;
    const user = auth.currentUser;
    if (!user) {
      setCommentError('You must be signed in to comment.');
      return;
    }
    const body = newCommentBody.trim();
    if (!body) {
      setCommentError('Enter a comment before posting.');
      return;
    }
    setCommentSubmitting(true);
    try {
      await addDoc(collection(db, 'projects', projectId, 'tasks', detailTaskId, 'comments'), {
        body,
        uid: user.uid,
        userName: user.displayName || user.email || null,
        createdAt: serverTimestamp(),
      });
      setNewCommentBody('');
      setCommentError(null);
      await loadTaskComments(detailTaskId);
    } catch (err) {
      console.error('Failed to post comment', err);
      setCommentError('Could not post comment. Please try again.');
    } finally {
      setCommentSubmitting(false);
    }
  };

  const submitOffer = async (taskId: string) => {
    if (!projectId) { alert('Project is unavailable.'); return; }
    if (!offerForm.totalAmount.trim()) {
      alert('Enter a total amount for the outsourced work.');
      return;
    }
    if (offerForm.targetType === 'franchise' && !offerForm.targetFranchiseId) {
      alert('Select a franchise to send the offer to.');
      return;
    }
    setOfferSubmitting(true);
    try {
      await ensureFirebase();
      const callable = httpsCallable(functions, 'taskOffers_create');
      await callable({
        projectId,
        taskId,
        role: offerForm.role || null,
        targetType: offerForm.targetType,
        targetFranchiseId: offerForm.targetType === 'franchise' ? offerForm.targetFranchiseId : null,
        targetUserId: offerForm.targetUserId || null,
        totalAmount: offerForm.totalAmount,
        depositAmount:
          offerForm.paymentMode === 'deposit_balance' ? offerForm.depositAmount || '0' : '0',
        paymentMode: offerForm.paymentMode,
        currency: offerForm.currency || 'GBP',
        notes: offerForm.notes || null,
      });
      await reloadTasks();
      closeOfferForm();
    } catch (err: any) {
      console.error('Failed to submit outsourcing offer', err);
      alert(err?.message || 'Unable to submit outsourcing offer.');
    } finally {
      setOfferSubmitting(false);
    }
  };

  const respondToOffer = async (
    taskId: string,
    offerId: string,
    action: 'accept' | 'reject' | 'withdraw' | 'counter',
    payload: Record<string, unknown> = {}
  ) => {
    if (!projectId) { alert('Project is unavailable.'); return; }
    setActionState(`${taskId}:${action}`);
    try {
      await ensureFirebase();
      const callable = httpsCallable(functions, 'taskOffers_respond');
      await callable({
        projectId,
        taskId,
        offerId,
        action,
        ...payload,
      });
      await reloadTasks();
      if (action === 'counter') {
        setCounterState({ ...COUNTER_FORM_DEFAULTS });
      }
    } catch (err: any) {
      console.error('Failed to update outsourcing offer', err);
      alert(err?.message || 'Unable to update offer.');
    } finally {
      setActionState(null);
    }
  };

  const openCounterForm = (taskId: string, proposal: any) => {
    const baseCurrency =
      typeof proposal?.counter?.currency === 'string' && proposal.counter.currency
        ? proposal.counter.currency
        : typeof proposal?.currency === 'string' && proposal.currency
          ? proposal.currency
          : 'GBP';
    const defaultModeValue =
      (proposal?.counter?.paymentMode ?? proposal?.paymentMode) === 'balance_on_completion'
        ? 'balance_on_completion'
        : 'deposit_balance';
    const defaultTotal =
      typeof proposal?.counter?.totalAmount === 'number'
        ? String(proposal.counter.totalAmount)
        : typeof proposal?.totalAmount === 'number'
          ? String(proposal.totalAmount)
          : '';
    const defaultDeposit =
      defaultModeValue === 'deposit_balance'
        ? typeof (proposal?.counter?.depositAmount ?? proposal?.depositAmount) === 'number'
          ? String(proposal?.counter?.depositAmount ?? proposal?.depositAmount)
          : ''
        : '';
    setCounterState({
      taskId,
      totalAmount: defaultTotal,
      depositAmount: defaultDeposit,
      paymentMode: defaultModeValue as PaymentMode,
      currency: baseCurrency,
      notes: '',
    });
  };

  const cancelCounterForm = () => {
    setCounterState({ ...COUNTER_FORM_DEFAULTS });
  };

  const submitCounter = async () => {
    if (!projectId) { alert('Project is unavailable.'); return; }
    if (!counterState.taskId) { alert('No task selected for counter offer.'); return; }
    if (!counterState.totalAmount.trim()) {
      alert('Enter a counter total amount.');
      return;
    }
    const task = tasks.find((t) => t.id === counterState.taskId);
    const proposal = task?.outsourcingProposal as any;
    const offerId = proposal?.offerId;
    if (!offerId) {
      alert('Unable to find the active offer to counter.');
      return;
    }
    await respondToOffer(counterState.taskId, offerId, 'counter', {
      totalAmount: counterState.totalAmount,
      depositAmount:
        counterState.paymentMode === 'deposit_balance' ? counterState.depositAmount || '0' : '0',
      paymentMode: counterState.paymentMode,
      currency: counterState.currency || proposal?.currency || 'GBP',
      notes: counterState.notes || null,
    });
  };

  if (loading) return <p>Loading…</p>;
  if (!project) return <p>Project not found.</p>;
  const selectedTask = detailTaskId ? tasks.find((t) => t.id === detailTaskId) || null : null;
  const canEditTask = !!userContext.canManage;

  return (
    <>
      <PortalContainer>
        <div className="grid gap-6">
          <h1 className="text-lg font-semibold text-gray-900">Project Tasks</h1>
          {isStaffOrAdmin ? (
            <div className="card grid max-w-md gap-3 p-4">
              <h2 className="text-base font-semibold text-gray-900">Add Task</h2>
              <input
                type="text"
                className="input"
                placeholder="Title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <textarea
                className="input"
                placeholder="Description (optional)"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              <input
                type="date"
                className="input"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
              <select
                className="input"
                value={assignedTo}
                onChange={(event) => setAssignedTo(event.target.value)}
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.uid} value={member.uid}>
                    {member.name}
                  </option>
                ))}
              </select>
              <button className="btn w-fit" onClick={addTask}>
                Create Task
              </button>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {['todo', 'in_progress', 'review', 'done'].map((status) => (
              <div key={status} className="min-h-[200px] rounded-md border p-3">
                <h3 className="mb-2 font-semibold capitalize">
                  {status.replace('_', ' ')}
                </h3>
                {tasks.filter((task) => task.status === status).length === 0 ? (
                  <p className="text-sm text-gray-500">No tasks</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {tasks
                      .filter((task) => task.status === status)
                      .map((task) => {
                    const proposal = task.outsourcingProposal as any;
                    const agreement = task.outsourcingAgreement as any;
                    const offerId = typeof proposal?.offerId === 'string' ? proposal.offerId : null;
                    const offerStatus = typeof proposal?.status === 'string' ? proposal.status : null;
                    const hasOpenOffer = offerStatus === 'pending' || offerStatus === 'countered';
                    const allowNewOffer =
                      userContext.canOutsource &&
                      (!proposal || offerStatus === 'rejected' || offerStatus === 'withdrawn') &&
                      !agreement;
                    const userFranchiseIds = userContext.franchiseIds || [];
                    const userIsRequester = proposal?.proposedByUid === userContext.uid;
                    const userIsTarget =
                      proposal?.targetType === 'hq'
                        ? userContext.isHq
                        : proposal?.targetFranchiseId
                          ? userFranchiseIds.includes(proposal.targetFranchiseId)
                          : false;
                    const awaitingTargetDecision = offerStatus === 'pending' && userIsTarget;
                    const awaitingRequesterDecision = offerStatus === 'countered' && userIsRequester;
                    const canWithdraw =
                      userIsRequester &&
                      offerId &&
                      (offerStatus === 'pending' || offerStatus === 'countered');
                    const showCounterForm =
                      counterState.taskId === task.id &&
                      (awaitingTargetDecision || awaitingRequesterDecision);
                    const franchiseLabel =
                      proposal?.targetType === 'franchise'
                        ? franchiseMap.get(proposal.targetFranchiseId)?.name || proposal.targetFranchiseId
                        : 'Head Office';
                    const statusLabel = offerStatus ? offerStatus.replace(/_/g, ' ') : 'pending';
                    const dueDisplay = formatTaskDateDisplay(task.dueDate);

                    return (
                      <div key={task.id} className="card grid gap-2 p-3">
                        <p className="font-medium text-sm">{task.title}</p>
                        {task.description && (
                          <p className="text-xs text-gray-600">{task.description}</p>
                        )}
                        {dueDisplay && (
                          <p className="text-xs text-gray-500">Due: {dueDisplay}</p>
                        )}
                        <p className="text-xs text-gray-600">
                          Assigned: {task.assigneeName || 'Unassigned'}
                        </p>
                        {isStaffOrAdmin && (
                          <div className="grid gap-2">
                            <select
                              className="input mt-1"
                              value={task.status}
                              onChange={(event) => updateTaskStatus(task.id, event.target.value)}
                            >
                              <option value="todo">To Do</option>
                              <option value="in_progress">In Progress</option>
                              <option value="review">Review</option>
                              <option value="done">Done</option>
                            </select>
                            <select
                              className="input"
                              value={task.assignedTo || ''}
                              onChange={(event) => updateTaskAssignee(task.id, event.target.value)}
                            >
                              <option value="">Unassigned</option>
                              {members.map((m) => (
                                <option key={m.uid} value={m.uid}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <button
                          className={secondaryActionClasses}
                          onClick={() => openTaskDetails(task.id)}
                        >
                          View details
                        </button>

                        {proposal && (
                          <div className="mt-2 space-y-2 rounded border border-dashed border-gray-300 p-2 text-xs text-gray-600">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold uppercase tracking-wide text-gray-500">
                                Outsourcing offer
                              </span>
                              <span className="text-[11px] font-semibold uppercase text-gray-700">
                                {statusLabel}
                              </span>
                            </div>
                            <div className="space-y-1">
                              <p>Target: {franchiseLabel}</p>
                              {proposal.role && <p>Role: {proposal.role}</p>}
                              <p>Fee: {formatMoney(proposal.totalAmount, proposal.currency) || '—'}</p>
                              {proposal.paymentMode === 'deposit_balance' ? (
                                <p>
                                  Deposit: {formatMoney(proposal.depositAmount, proposal.currency) || '—'} ·
                                  Balance: {formatMoney(proposal.balanceAmount, proposal.currency) || '—'}
                                </p>
                              ) : (
                                <p>Payment: Balance on completion</p>
                              )}
                              {proposal.notes && (
                                <p className="text-gray-500">Notes: {proposal.notes}</p>
                              )}
                            </div>
                            {proposal.counter && offerStatus === 'countered' && (
                              <div className="rounded bg-amber-50 p-2 text-amber-700">
                                <p className="font-semibold">Counter offer pending review</p>
                                <p>
                                  Total:{' '}
                                  {formatMoney(
                                    proposal.counter.totalAmount,
                                    proposal.counter.currency
                                  ) || '—'}
                                </p>
                                {proposal.counter.paymentMode === 'deposit_balance' ? (
                                  <p>
                                    Deposit:{' '}
                                    {formatMoney(
                                      proposal.counter.depositAmount,
                                      proposal.counter.currency
                                    ) || '—'}
                                    {' · '}Balance:{' '}
                                    {formatMoney(
                                      proposal.counter.balanceAmount,
                                      proposal.counter.currency
                                    ) || '—'}
                                  </p>
                                ) : (
                                  <p>Payment: Balance on completion</p>
                                )}
                                {proposal.counter.notes && (
                                  <p className="text-amber-800">Notes: {proposal.counter.notes}</p>
                                )}
                              </div>
                            )}
                            {agreement && (
                              <div className="rounded bg-emerald-50 p-2 text-emerald-700">
                                <p className="font-semibold">Accepted outsourcing agreement</p>
                                <p>
                                  Total: {formatMoney(agreement.totalAmount, agreement.currency) || '—'}
                                </p>
                                {agreement.paymentMode === 'deposit_balance' ? (
                                  <p>
                                    Deposit:{' '}
                                    {formatMoney(agreement.depositAmount, agreement.currency) || '—'}
                                    {' · '}Balance:{' '}
                                    {formatMoney(agreement.balanceAmount, agreement.currency) || '—'}
                                  </p>
                                ) : (
                                  <p>Payment: Balance on completion</p>
                                )}
                              </div>
                            )}
                            {(awaitingTargetDecision || awaitingRequesterDecision || canWithdraw) && offerId && (
                              <div className="flex flex-wrap gap-2">
                                {awaitingTargetDecision && (
                                  <>
                                    <button
                                      className={primaryActionClasses}
                                      onClick={() => respondToOffer(task.id, offerId, 'accept')}
                                      disabled={actionState === `${task.id}:accept`}
                                    >
                                      {actionState === `${task.id}:accept` ? 'Accepting…' : 'Accept'}
                                    </button>
                                    <button
                                      className={dangerActionClasses}
                                      onClick={() => respondToOffer(task.id, offerId, 'reject')}
                                      disabled={actionState === `${task.id}:reject`}
                                    >
                                      {actionState === `${task.id}:reject` ? 'Rejecting…' : 'Reject'}
                                    </button>
                                    <button
                                      className={secondaryActionClasses}
                                      onClick={() => openCounterForm(task.id, proposal)}
                                      disabled={showCounterForm && actionState === `${task.id}:counter`}
                                    >
                                      Counter
                                    </button>
                                  </>
                                )}
                                {awaitingRequesterDecision && (
                                  <>
                                    <button
                                      className={primaryActionClasses}
                                      onClick={() => respondToOffer(task.id, offerId, 'accept')}
                                      disabled={actionState === `${task.id}:accept`}
                                    >
                                      {actionState === `${task.id}:accept`
                                        ? 'Accepting…'
                                        : 'Accept counter'}
                                    </button>
                                    <button
                                      className={dangerActionClasses}
                                      onClick={() => respondToOffer(task.id, offerId, 'reject')}
                                      disabled={actionState === `${task.id}:reject`}
                                    >
                                      {actionState === `${task.id}:reject`
                                        ? 'Rejecting…'
                                        : 'Decline counter'}
                                    </button>
                                    <button
                                      className={secondaryActionClasses}
                                      onClick={() =>
                                        openCounterForm(task.id, proposal.counter ?? proposal)
                                      }
                                      disabled={showCounterForm && actionState === `${task.id}:counter`}
                                    >
                                      Counter again
                                    </button>
                                  </>
                                )}
                                {canWithdraw && (
                                  <button
                                    className={secondaryActionClasses}
                                    onClick={() => respondToOffer(task.id, offerId, 'withdraw')}
                                    disabled={actionState === `${task.id}:withdraw`}
                                  >
                                    {actionState === `${task.id}:withdraw`
                                      ? 'Withdrawing…'
                                      : 'Withdraw offer'}
                                  </button>
                                )}
                              </div>
                            )}
                            {showCounterForm && (
                              <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-amber-800">
                                <div className="grid gap-2">
                                  <div>
                                    <label className="block text-[11px] font-semibold uppercase">
                                      Counter total
                                    </label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      className="input mt-1"
                                      value={counterState.totalAmount}
                                      onChange={(event) =>
                                        setCounterState((prev) => ({
                                          ...prev,
                                          totalAmount: event.target.value,
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[11px] font-semibold uppercase">
                                        Currency
                                      </label>
                                      <input
                                        type="text"
                                        className="input mt-1"
                                        value={counterState.currency}
                                        onChange={(event) =>
                                          setCounterState((prev) => ({
                                            ...prev,
                                            currency: event.target.value,
                                          }))
                                        }
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[11px] font-semibold uppercase">
                                        Payment schedule
                                      </label>
                                      <select
                                        className="input mt-1"
                                        value={counterState.paymentMode}
                                        onChange={(event) => {
                                          const mode = event.target.value as PaymentMode;
                                          setCounterState((prev) => ({
                                            ...prev,
                                            paymentMode: mode,
                                            depositAmount:
                                              mode === 'deposit_balance' ? prev.depositAmount : '',
                                          }));
                                        }}
                                      >
                                        <option value="deposit_balance">Deposit + balance</option>
                                        <option value="balance_on_completion">Balance on completion</option>
                                      </select>
                                    </div>
                                  </div>
                                  {counterState.paymentMode === 'deposit_balance' && (
                                    <div>
                                      <label className="block text-[11px] font-semibold uppercase">
                                        Deposit amount
                                      </label>
                                      <input
                                        type="number"
                                        step="0.01"
                                        className="input mt-1"
                                        value={counterState.depositAmount}
                                        onChange={(event) =>
                                          setCounterState((prev) => ({
                                            ...prev,
                                            depositAmount: event.target.value,
                                          }))
                                        }
                                      />
                                    </div>
                                  )}
                                  <div>
                                    <label className="block text-[11px] font-semibold uppercase">
                                      Notes (optional)
                                    </label>
                                    <textarea
                                      className="input mt-1"
                                      rows={2}
                                      value={counterState.notes}
                                      onChange={(event) =>
                                        setCounterState((prev) => ({
                                          ...prev,
                                          notes: event.target.value,
                                        }))
                                      }
                                    />
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    className={primaryActionClasses}
                                    onClick={submitCounter}
                                    disabled={actionState === `${task.id}:counter`}
                                  >
                                    {actionState === `${task.id}:counter`
                                      ? 'Sending…'
                                      : 'Send counter'}
                                  </button>
                                  <button
                                    className={secondaryActionClasses}
                                    onClick={cancelCounterForm}
                                    disabled={actionState === `${task.id}:counter`}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {allowNewOffer && (
                          activeOfferTaskId === task.id ? (
                            <div className="mt-2 space-y-2 rounded border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                              <div className="grid gap-2">
                                <div>
                                  <label className="block text-[11px] font-semibold uppercase">
                                    Role / service
                                  </label>
                                  <input
                                    type="text"
                                    className="input mt-1"
                                    value={offerForm.role}
                                    onChange={(event) =>
                                      setOfferForm((prev) => ({
                                        ...prev,
                                        role: event.target.value,
                                      }))
                                    }
                                  />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-semibold uppercase">
                                    Send to
                                  </label>
                                  <select
                                    className="input mt-1"
                                    value={offerForm.targetType}
                                    onChange={(event) => {
                                      const target = event.target.value as 'hq' | 'franchise';
                                      setOfferForm((prev) => ({
                                        ...prev,
                                        targetType: target,
                                        targetFranchiseId:
                                          target === 'franchise' ? prev.targetFranchiseId : '',
                                      }));
                                    }}
                                  >
                                    <option value="hq">Head Office</option>
                                    <option value="franchise">Franchise</option>
                                  </select>
                                </div>
                                {offerForm.targetType === 'franchise' && (
                                  <div>
                                    <label className="block text-[11px] font-semibold uppercase">
                                      Franchise
                                    </label>
                                    <select
                                      className="input mt-1"
                                      value={offerForm.targetFranchiseId}
                                      onChange={(event) =>
                                        setOfferForm((prev) => ({
                                          ...prev,
                                          targetFranchiseId: event.target.value,
                                        }))
                                      }
                                    >
                                      <option value="">Select franchise</option>
                                      {franchises.map((franchise) => (
                                        <option key={franchise.id} value={franchise.id}>
                                          {franchise.name || franchise.id}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                                <div>
                                  <label className="block text-[11px] font-semibold uppercase">
                                    Assignee user ID (optional)
                                  </label>
                                  <input
                                    type="text"
                                    className="input mt-1"
                                    value={offerForm.targetUserId}
                                    onChange={(event) =>
                                      setOfferForm((prev) => ({
                                        ...prev,
                                        targetUserId: event.target.value,
                                      }))
                                    }
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[11px] font-semibold uppercase">
                                      Total amount
                                    </label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      className="input mt-1"
                                      value={offerForm.totalAmount}
                                      onChange={(event) =>
                                        setOfferForm((prev) => ({
                                          ...prev,
                                          totalAmount: event.target.value,
                                        }))
                                      }
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] font-semibold uppercase">
                                      Currency
                                    </label>
                                    <input
                                      type="text"
                                      className="input mt-1"
                                      value={offerForm.currency}
                                      onChange={(event) =>
                                        setOfferForm((prev) => ({
                                          ...prev,
                                          currency: event.target.value,
                                        }))
                                      }
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-[11px] font-semibold uppercase">
                                    Payment schedule
                                  </label>
                                  <select
                                    className="input mt-1"
                                    value={offerForm.paymentMode}
                                    onChange={(event) => {
                                      const mode = event.target.value as PaymentMode;
                                      setOfferForm((prev) => ({
                                        ...prev,
                                        paymentMode: mode,
                                        depositAmount:
                                          mode === 'deposit_balance' ? prev.depositAmount : '',
                                      }));
                                    }}
                                  >
                                    <option value="deposit_balance">Deposit + balance</option>
                                    <option value="balance_on_completion">Balance on completion</option>
                                  </select>
                                </div>
                                {offerForm.paymentMode === 'deposit_balance' && (
                                  <div>
                                    <label className="block text-[11px] font-semibold uppercase">
                                      Deposit amount
                                    </label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      className="input mt-1"
                                      value={offerForm.depositAmount}
                                      onChange={(event) =>
                                        setOfferForm((prev) => ({
                                          ...prev,
                                          depositAmount: event.target.value,
                                        }))
                                      }
                                    />
                                  </div>
                                )}
                                <div>
                                  <label className="block text-[11px] font-semibold uppercase">
                                    Notes (optional)
                                  </label>
                                  <textarea
                                    className="input mt-1"
                                    rows={2}
                                    value={offerForm.notes}
                                    onChange={(event) =>
                                      setOfferForm((prev) => ({
                                        ...prev,
                                        notes: event.target.value,
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  className={primaryActionClasses}
                                  onClick={() => submitOffer(task.id)}
                                  disabled={offerSubmitting}
                                >
                                  {offerSubmitting ? 'Submitting…' : 'Send offer'}
                                </button>
                                <button
                                  className={secondaryActionClasses}
                                  onClick={closeOfferForm}
                                  disabled={offerSubmitting}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className={secondaryActionClasses}
                              onClick={() => openOfferForm(task.id)}
                            >
                              Propose outsourcing
                            </button>
                          )
                        )}

                        {userContext.canOutsource && hasOpenOffer && !showCounterForm && !awaitingTargetDecision && !awaitingRequesterDecision && offerStatus && (
                          <p className="text-[11px] text-gray-500">
                            Waiting on {proposal?.targetType === 'hq' ? 'HQ' : 'franchise'} response.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      </PortalContainer>

      {detailTaskId && selectedTask ? (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/40 p-4">
          <div className="flex h-full w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b p-4">
              <div className="min-w-0 space-y-1">
                <h2 className="text-lg font-semibold text-gray-900">
                  {detailForm.title || selectedTask.title || 'Task details'}
                </h2>
                <p className="text-xs text-gray-500">
                  Status: {detailForm.status.replace('_', ' ')}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={closeTaskDetails}
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <label className="text-xs font-semibold uppercase text-gray-500">Title</label>
                  <input
                    className="input"
                    value={detailForm.title}
                    onChange={(event) =>
                      setDetailForm((prev) => ({ ...prev, title: event.target.value }))
                    }
                    disabled={!canEditTask}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-semibold uppercase text-gray-500">Description</label>
                  <textarea
                    className="input min-h-[96px] resize-y"
                    value={detailForm.description}
                    onChange={(event) =>
                      setDetailForm((prev) => ({ ...prev, description: event.target.value }))
                    }
                    disabled={!canEditTask}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-xs font-semibold uppercase text-gray-500">
                    Due date
                    <input
                      type="date"
                      className="input"
                      value={detailForm.dueDate}
                      onChange={(event) =>
                        setDetailForm((prev) => ({ ...prev, dueDate: event.target.value }))
                      }
                      disabled={!canEditTask}
                    />
                  </label>
                  <label className="grid gap-2 text-xs font-semibold uppercase text-gray-500">
                    Assigned to
                    <select
                      className="input"
                      value={detailForm.assignedTo}
                      onChange={(event) =>
                        setDetailForm((prev) => ({ ...prev, assignedTo: event.target.value }))
                      }
                      disabled={!canEditTask}
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.uid} value={m.uid}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-semibold uppercase text-gray-500">Status</label>
                  <select
                    className="input"
                    value={detailForm.status}
                    onChange={(event) =>
                      setDetailForm((prev) => ({ ...prev, status: event.target.value }))
                    }
                    disabled={!canEditTask}
                  >
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="review">Review</option>
                    <option value="done">Done</option>
                  </select>
                </div>
                <div className="grid gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">Comments</h3>
                    {commentsLoading && <span className="text-xs text-gray-500">Loading…</span>}
                  </div>
                  {detailComments.length ? (
                    <ul className="grid gap-3">
                      {detailComments.map((comment) => {
                        const authorLabel =
                          comment.userName ||
                          (comment.uid ? membersMap.get(comment.uid) : null) ||
                          'Team member';
                        const timestamp = formatCommentTimestamp(comment.createdAt);
                        return (
                          <li
                            key={comment.id}
                            className="rounded border border-gray-200 p-3"
                          >
                            <p className="whitespace-pre-wrap text-sm text-gray-800">{comment.body}</p>
                            <div className="mt-2 flex justify-between text-xs text-gray-500">
                              <span>{authorLabel}</span>
                              {timestamp && <span>{timestamp}</span>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : !commentsLoading ? (
                    <p className="text-xs text-gray-500">No comments yet.</p>
                  ) : null}
                  <div className="grid gap-2">
                    <label className="text-xs font-semibold uppercase text-gray-500">
                      Add a comment
                    </label>
                    <textarea
                      className="input min-h-[80px] resize-y"
                      value={newCommentBody}
                      onChange={(event) => setNewCommentBody(event.target.value)}
                    />
                    {commentError && <p className="text-xs text-red-600">{commentError}</p>}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => setNewCommentBody('')}
                        disabled={commentSubmitting || !newCommentBody.trim()}
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={submitComment}
                        disabled={commentSubmitting}
                      >
                        {commentSubmitting ? 'Posting…' : 'Add comment'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-t bg-gray-50 p-4">
              {detailError ? (
                <p className="text-sm text-red-600">{detailError}</p>
              ) : (
                <span className="text-sm text-gray-500">
                  {formatTaskDateDisplay(selectedTask?.dueDate)
                    ? `Due ${formatTaskDateDisplay(selectedTask?.dueDate)}`
                    : ''}
                </span>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={closeTaskDetails}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={saveTaskDetails}
                  disabled={!canEditTask || detailSaving}
                >
                  {detailSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
