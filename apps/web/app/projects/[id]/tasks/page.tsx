"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { auth, db } from '@/lib/firebase';
import { collection, getDoc, doc, getDocs, addDoc, updateDoc, serverTimestamp, query, where, orderBy } from 'firebase/firestore';
import { extractUserRoles, hasRole } from '@/lib/roles';

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

  // Load project and tasks
  useEffect(() => {
    (async () => {
      if (!projectId) return;
      const pDoc = await getDoc(doc(db, 'projects', projectId));
      if (!pDoc.exists()) { setProject(null); setLoading(false); return; }
      const proj = pDoc.data() as any;
      setProject(proj);
      // Determine if user is staff or client_admin of the org
      const user = auth.currentUser;
      if (!user) { setIsStaffOrAdmin(false); } else {
        const uSnap = await getDoc(doc(db, 'users', user.uid));
        const me = uSnap.data() as any;
        const roles = extractUserRoles(me);
        let canEdit = hasRole(roles, ['admin', 'projects']);
        // Check membership role
        const memDoc = await getDoc(doc(db, 'memberships', proj.orgId + '_' + user.uid));
        if (memDoc.exists()) {
          const mem = memDoc.data() as any;
          if (mem.role === 'client_admin') canEdit = true;
        }
        setIsStaffOrAdmin(canEdit);
      }
      // Load tasks
      const tSnap = await getDocs(
        query(collection(db, 'projects', projectId, 'tasks'), orderBy('createdAt', 'desc'))
      );
      setTasks(tSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      // Load members for assignment
      const memSnap = await getDocs(query(collection(db, 'memberships'), where('orgId', '==', proj.orgId)));
      const mems = memSnap.docs.map((d) => d.data() as any);
      const userSnaps = await Promise.all(mems.map((m) => getDoc(doc(db, 'users', m.userId))));
      setMembers(
        mems.map((m, i) => {
          const u = userSnaps[i];
          const data = u.data() as any;
          return {
            uid: m.userId,
            name: data?.displayName || data?.email || 'Unnamed',
          };
        })
      );
      setLoading(false);
    })();
  }, [projectId]);

  const addTask = async () => {
    if (!title.trim()) { alert('Task title is required'); return; }
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
      const snap = await getDocs(
        query(collection(db, 'projects', projectId, 'tasks'), orderBy('createdAt', 'desc'))
      );
      setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setTitle(''); setDescription(''); setDueDate(''); setAssignedTo('');
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error creating task');
    }
  };

  const updateTaskStatus = async (taskId: string, newStatus: string) => {
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
      setTasks(tasks.map((t) => t.id === taskId ? { ...t, status: newStatus } : t));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating task');
    }
  };

  const updateTaskAssignee = async (taskId: string, uid: string) => {
    try {
      const member = members.find((m) => m.uid === uid);
      await updateDoc(doc(db, 'projects', projectId, 'tasks', taskId), {
        assignedTo: uid || null,
        assigneeName: member?.name || null,
      });
      setTasks(
        tasks.map((t) =>
          t.id === taskId ? { ...t, assignedTo: uid || null, assigneeName: member?.name || null } : t
        )
      );
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error assigning task');
    }
  };

  if (loading) return <p>Loading…</p>;
  if (!project) return <p>Project not found.</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Project Tasks</h1>
      {isStaffOrAdmin ? (
        <div className="card p-4 grid gap-3 max-w-md">
          <h2 className="font-semibold">Add Task</h2>
          <input type="text" className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <select className="input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.uid} value={m.uid}>{m.name}</option>
            ))}
          </select>
          <button className="btn w-fit" onClick={addTask}>Create Task</button>
        </div>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {['todo','in_progress','review','done'].map((status) => (
          <div key={status} className="border rounded-md p-3 min-h-[200px]">
            <h3 className="font-semibold mb-2 capitalize">{status.replace('_', ' ')}</h3>
            {tasks.filter((t) => t.status === status).length === 0 ? (
              <p className="text-sm text-gray-500">No tasks</p>
            ) : (
              <div className="flex flex-col gap-2">
                {tasks.filter((t) => t.status === status).map((task) => (
                  <div key={task.id} className="card p-2 grid gap-1">
                    <p className="font-medium text-sm">{task.title}</p>
                    {task.description && <p className="text-xs text-gray-600">{task.description}</p>}
                    {task.dueDate && <p className="text-xs text-gray-500">Due: {task.dueDate}</p>}
                    <p className="text-xs text-gray-600">Assigned: {task.assigneeName || 'Unassigned'}</p>
                    {isStaffOrAdmin && (
                      <>
                        <select className="input mt-1" value={task.status} onChange={(e) => updateTaskStatus(task.id, e.target.value)}>
                          <option value="todo">To Do</option>
                          <option value="in_progress">In Progress</option>
                          <option value="review">Review</option>
                          <option value="done">Done</option>
                        </select>
                        <select className="input mt-1" value={task.assignedTo || ''} onChange={(e) => updateTaskAssignee(task.id, e.target.value)}>
                          <option value="">Unassigned</option>
                          {members.map((m) => (
                            <option key={m.uid} value={m.uid}>{m.name}</option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}