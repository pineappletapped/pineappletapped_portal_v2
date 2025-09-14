"use client";

import { useEffect, useState } from 'react';
import { auth, db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';

/**
 * Admin Workflows Management
 *
 * Allows creation and editing of workflows. A workflow defines a set of tasks
 * that are automatically created for a project when a service is ordered. Tasks
 * can request information from the client (via fieldType) or represent internal
 * steps. Only staff can manage workflows.
 */
interface Task {
  title: string;
  description: string;
  dueDays: string;
  fieldType: string;
  forCustomer: boolean;
}

export default function AdminWorkflowsPage() {
  const [isStaff, setIsStaff] = useState<boolean | null>(null);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) { setIsStaff(false); setLoading(false); return; }
      const uSnap = await getDoc(doc(db, 'users', user.uid));
      const me = uSnap.data() as any;
      setIsStaff(me?.isStaff === true);
      if (me?.isStaff) {
        await loadWorkflows();
      }
      setLoading(false);
    })();
  }, []);

  const loadWorkflows = async () => {
    const snap = await getDocs(collection(db, 'workflows'));
    setWorkflows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  };

  const addTask = () => {
    setTasks([...tasks, { title: '', description: '', dueDays: '', fieldType: 'text', forCustomer: false }]);
  };
  const updateTask = (index: number, field: keyof Task, value: any) => {
    const updated = tasks.map((t, i) => (i === index ? { ...t, [field]: value } : t));
    setTasks(updated);
  };
  const removeTask = (index: number) => {
    const updated = tasks.filter((_, i) => i !== index);
    setTasks(updated);
  };
  const createWorkflow = async () => {
    if (!name.trim()) { alert('Name is required'); return; }
    try {
      const callable = httpsCallable(functions, 'admin_createWorkflow');
      await callable({ name: name.trim(), description: description.trim(), tasks });
      await loadWorkflows();
      setName(''); setDescription(''); setTasks([]);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error creating workflow');
    }
  };

  const startEdit = (wf: any) => {
    setEditingId(wf.id);
    setEditName(wf.name);
    setEditDescription(wf.description || '');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const callable = httpsCallable(functions, 'admin_updateWorkflow');
      await callable({ workflowId: editingId, updates: { name: editName, description: editDescription } });
      await loadWorkflows();
      setEditingId(null);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error updating workflow');
    }
  };

  const deleteWorkflow = async (id: string) => {
    if (!confirm('Delete this workflow?')) return;
    try {
      const callable = httpsCallable(functions, 'admin_deleteWorkflow');
      await callable({ workflowId: id });
      setWorkflows(workflows.filter((w) => w.id !== id));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error deleting workflow');
    }
  };

  if (loading) return <p>Loading…</p>;
  if (!isStaff) return <p>You do not have permission to manage workflows.</p>;
  return (
    <div className="grid gap-6">
      <h1 className="text-xl font-semibold">Manage Workflows</h1>
      {/* Create workflow form */}
      <div className="card p-4 grid gap-3 max-w-xl">
        <h2 className="font-semibold">Create Workflow</h2>
        <input type="text" className="input" placeholder="Workflow name" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea className="input" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="grid gap-2">
          <h3 className="font-semibold">Tasks</h3>
          {tasks.map((task, i) => (
            <div key={i} className="border p-3 rounded-md grid gap-2 bg-gray-50">
              <div className="flex justify-between items-center">
                <p className="font-medium">Task {i + 1}</p>
                <button className="text-red-600 text-sm" onClick={() => removeTask(i)}>Remove</button>
              </div>
              <input type="text" className="input" placeholder="Title" value={task.title} onChange={(e) => updateTask(i, 'title', e.target.value)} />
              <textarea className="input" placeholder="Description" value={task.description} onChange={(e) => updateTask(i, 'description', e.target.value)} />
              <input
                type="number"
                className="input"
                placeholder="Due days (offset)"
                value={task.dueDays}
                onChange={(e) => updateTask(i, 'dueDays', e.target.value)}
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={task.forCustomer}
                  onChange={(e) => updateTask(i, 'forCustomer', e.target.checked)}
                />
                For customer
              </label>
              {task.forCustomer && (
                <select
                  className="input"
                  value={task.fieldType}
                  onChange={(e) => updateTask(i, 'fieldType', e.target.value)}
                >
                  <option value="text">Text</option>
                  <option value="file">File Upload</option>
                  <option value="date">Date</option>
                  <option value="select">Select</option>
                </select>
              )}
            </div>
          ))}
          <button className="btn-sm w-fit" onClick={addTask}>Add Task</button>
        </div>
        <button className="btn w-fit" onClick={createWorkflow}>Create Workflow</button>
      </div>
      {/* Workflows list */}
      <div>
        <h2 className="font-semibold mb-2">Existing Workflows</h2>
        {workflows.length === 0 ? <p>No workflows.</p> : (
          <div className="grid gap-3">
            {workflows.map((wf) => (
              <div key={wf.id} className="card p-4 grid gap-2">
                {editingId === wf.id ? (
                  <div className="grid gap-2">
                    <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    <textarea className="input" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                    <div className="flex gap-2">
                      <button className="btn-sm" onClick={saveEdit}>Save</button>
                      <button className="btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3 className="font-medium text-lg">{wf.name}</h3>
                    <p className="text-sm text-gray-700">{wf.description}</p>
                    <p className="text-sm">Tasks: {Array.isArray(wf.tasks) ? wf.tasks.length : 0}</p>
                    {Array.isArray(wf.tasks) && wf.tasks.length > 0 && (
                      <div className="ml-3 border-l pl-3 space-y-1">
                        {wf.tasks.map((t: any, idx: number) => (
                          <p key={idx} className="text-sm text-gray-600">
                            {idx + 1}. {t.title} (due +{t.dueDays}d, field: {t.fieldType || 'n/a'}, forCustomer: {t.forCustomer ? 'yes' : 'no'})
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2 pt-2">
                      <button className="btn-sm" onClick={() => startEdit(wf)}>Edit</button>
                      <button className="btn-sm text-red-600" onClick={() => deleteWorkflow(wf.id)}>Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}