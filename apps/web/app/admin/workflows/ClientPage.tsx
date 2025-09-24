"use client";

import { useEffect, useState } from 'react';
import { ensureFirebase } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs } from 'firebase/firestore';
import { useRoleGate } from '@/hooks/useRoleGate';

/**
 * Admin Workflows Management
 *
 * Allows creation and editing of workflows. A workflow defines a set of tasks
 * that are automatically created for a project when a service is ordered. Tasks
 * can request information from the client (via fieldType) or represent internal
 * steps. Only staff can manage workflows.
 */
type TaskFieldType = 'none' | 'text' | 'textarea' | 'date' | 'file' | 'select' | 'team-member';

type AssignmentScope = 'team' | 'contractor';

interface TaskSelectOption {
  id: string;
  label: string;
  value: string;
}

interface Task {
  id: string;
  title: string;
  description: string;
  dueDays: string;
  forCustomer: boolean;
  fieldType: TaskFieldType;
  templateKey: string | null;
  fieldKey: string;
  fieldLabel: string;
  fieldPlaceholder: string;
  fieldHelpText: string;
  fieldRequired: boolean;
  fieldAccept: string;
  fieldOptions: TaskSelectOption[];
  dependsOn: string[];
  shareAssigneeContact: boolean;
  assignmentScope: AssignmentScope;
}

interface TaskFieldTemplate {
  key: string;
  label: string;
  description?: string;
  type: Exclude<TaskFieldType, 'none'>;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  accept?: string;
  options?: string[];
  defaultForCustomer?: boolean;
  assignmentScope?: AssignmentScope;
  shareAssigneeContact?: boolean;
}

const randomId = () =>
  typeof globalThis !== 'undefined' &&
  globalThis.crypto &&
  typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const FIELD_TEMPLATES: TaskFieldTemplate[] = [
  {
    key: 'customer-logo',
    label: 'Customer Logo',
    description: 'Collect the client’s primary logo in PNG, SVG or EPS format.',
    type: 'file',
    required: true,
    helpText: 'Upload a high-resolution logo we can use across deliverables.',
    accept: '.png,.svg,.eps,.ai,.pdf,image/*',
    defaultForCustomer: true,
  },
  {
    key: 'brand-colours',
    label: 'Customer Brand Colours',
    description: 'Request HEX or RGB values for the client’s colour palette.',
    type: 'textarea',
    placeholder: '#ff7f27, #222222',
    helpText: 'List each colour on a new line with any usage notes.',
    defaultForCustomer: true,
  },
  {
    key: 'brand-fonts',
    label: 'Customer Brand Fonts',
    description: 'Capture font families or style guides used in graphics.',
    type: 'textarea',
    placeholder: 'Heading: Montserrat Bold\nBody: Open Sans Regular',
    defaultForCustomer: true,
  },
  {
    key: 'team-member',
    label: 'Assigned Team Member',
    description:
      'Select who from the Pineapple Tapped team is attending so operations can issue passes and share contact details.',
    type: 'team-member',
    required: true,
    defaultForCustomer: false,
    assignmentScope: 'team',
    shareAssigneeContact: true,
  },
  {
    key: 'contractor',
    label: 'Assigned Contractor',
    description:
      'Choose the contractor responsible for this stage and automatically surface their email and phone number to the coordinator.',
    type: 'team-member',
    required: true,
    defaultForCustomer: false,
    assignmentScope: 'contractor',
    shareAssigneeContact: true,
  },
  {
    key: 'shoot-location',
    label: 'Shoot Location Details',
    description: 'Gather the address and access notes for where the filming takes place.',
    type: 'textarea',
    placeholder: 'Venue name, address, access times, parking info…',
    defaultForCustomer: true,
    helpText: 'Include arrival instructions so crew can plan travel and kit.',
  },
];

const FIELD_TYPE_OPTIONS: { value: TaskFieldType; label: string }[] = [
  { value: 'none', label: 'No response needed' },
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'date', label: 'Date' },
  { value: 'file', label: 'File upload' },
  { value: 'select', label: 'Dropdown' },
  { value: 'team-member', label: 'Team member assignment' },
];

const createSelectOption = (label = '', value?: string): TaskSelectOption => ({
  id: randomId(),
  label,
  value: value ?? label,
});

const createEmptyTask = (defaults?: Partial<Task>): Task => {
  const id = defaults?.id ?? randomId();
  return {
    id,
    title: defaults?.title ?? '',
    description: defaults?.description ?? '',
    dueDays: defaults?.dueDays ?? '',
    forCustomer: defaults?.forCustomer ?? false,
    fieldType: defaults?.fieldType ?? 'none',
    templateKey: defaults?.templateKey ?? null,
    fieldKey: defaults?.fieldKey ?? id,
    fieldLabel: defaults?.fieldLabel ?? '',
    fieldPlaceholder: defaults?.fieldPlaceholder ?? '',
    fieldHelpText: defaults?.fieldHelpText ?? '',
    fieldRequired: defaults?.fieldRequired ?? false,
    fieldAccept: defaults?.fieldAccept ?? '',
    fieldOptions: defaults?.fieldOptions ?? [],
    dependsOn: defaults?.dependsOn ?? [],
    shareAssigneeContact: defaults?.shareAssigneeContact ?? false,
    assignmentScope: defaults?.assignmentScope ?? 'team',
  };
};

const normaliseKeyBase = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const ensureUniqueFieldKey = (value: string, tasks: Task[], currentId: string) => {
  const base = normaliseKeyBase(value) || `field-${currentId.slice(0, 6)}`;
  let candidate = base;
  let counter = 2;
  while (tasks.some((task) => task.id !== currentId && task.fieldKey === candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
};

const applyTemplateToTask = (task: Task, template: TaskFieldTemplate, tasks: Task[]): Task => {
  const fieldKeySeed = `${template.key}-${task.id.slice(0, 6)}`;
  const nextFieldKey = ensureUniqueFieldKey(fieldKeySeed, tasks, task.id);
  const templateOptions = Array.isArray(template.options) ? template.options : [];
  const nextOptions =
    template.type === 'select'
      ? templateOptions.length > 0
        ? templateOptions.map((optionLabel) => createSelectOption(optionLabel))
        : task.fieldOptions.length > 0
          ? task.fieldOptions
          : [createSelectOption('Option 1'), createSelectOption('Option 2')]
      : [];
  const defaultRequired = template.type === 'team-member' ? true : task.fieldRequired;
  return {
    ...task,
    forCustomer:
      template.defaultForCustomer !== undefined
        ? template.defaultForCustomer
        : template.type === 'team-member'
          ? false
          : task.forCustomer,
    fieldType: template.type,
    templateKey: template.key,
    fieldKey: nextFieldKey,
    fieldLabel: template.label,
    fieldPlaceholder: template.placeholder ?? '',
    fieldHelpText: template.helpText ?? template.description ?? '',
    fieldRequired: template.required ?? defaultRequired,
    fieldAccept: template.accept ?? '',
    fieldOptions: nextOptions,
    shareAssigneeContact:
      template.type === 'team-member'
        ? template.shareAssigneeContact ?? true
        : task.shareAssigneeContact,
    assignmentScope:
      template.type === 'team-member'
        ? template.assignmentScope ?? task.assignmentScope
        : task.assignmentScope,
  };
};

const serializeTasksForSave = (tasks: Task[]) => {
  const idSet = new Set(tasks.map((task) => task.id));
  return tasks.map((task) => {
    const title = task.title.trim();
    const description = task.description.trim();
    const dueDays = task.dueDays.trim();
    const fieldLabel = task.fieldLabel.trim();
    const fieldPlaceholder = task.fieldPlaceholder.trim();
    const fieldHelpText = task.fieldHelpText.trim();
    const fieldAccept = task.fieldAccept.trim();
    const dependsOn = task.dependsOn.filter(
      (depId) => depId && depId !== task.id && idSet.has(depId)
    );
    const fieldOptions =
      task.fieldType === 'select'
        ? task.fieldOptions
            .map((option) => {
              const label = option.label.trim();
              const value = option.value.trim() || label;
              if (!label && !value) return null;
              return { label: label || value, value };
            })
            .filter((option): option is { label: string; value: string } => Boolean(option))
        : [];
    const rawFieldKey = (task.fieldKey || '').trim() || `field-${task.id.slice(0, 6)}`;
    const normalizedFieldKey = ensureUniqueFieldKey(rawFieldKey, tasks, task.id);
    const templateKey =
      task.templateKey && task.templateKey !== 'custom' ? task.templateKey : null;
    return {
      id: task.id,
      title,
      description,
      dueDays,
      forCustomer: task.forCustomer,
      fieldType: task.fieldType === 'none' ? null : task.fieldType,
      fieldTemplateKey: templateKey,
      fieldKey: normalizedFieldKey,
      fieldLabel: fieldLabel || (task.fieldType === 'none' ? '' : title),
      fieldPlaceholder,
      fieldHelpText,
      fieldRequired: task.fieldType === 'none' ? false : task.fieldRequired,
      fieldAccept: task.fieldType === 'file' ? fieldAccept : '',
      fieldOptions,
      dependsOn,
      shareAssigneeContact:
        task.fieldType === 'team-member' ? task.shareAssigneeContact === true : false,
      assignmentScope:
        task.fieldType === 'team-member' ? task.assignmentScope : null,
    };
  });
};

export default function AdminWorkflowsPage() {
  const { allowed, loading: guardLoading } = useRoleGate(['admin', 'operations']);
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
      if (guardLoading) return;
      if (!allowed) { setLoading(false); return; }
      await loadWorkflows();
      setLoading(false);
    })();
  }, [allowed, guardLoading]);

  const loadWorkflows = async () => {
    try {
      const { db } = await ensureFirebase();
      const snap = await getDocs(collection(db, 'workflows'));
      setWorkflows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error('Failed to load workflows', error);
      setWorkflows([]);
    }
  };

  const addTask = () => {
    setTasks((prev) => [...prev, createEmptyTask()]);
  };

  const updateTask = (taskId: string, updates: Partial<Task>) => {
    setTasks((prev) =>
      prev.map((task) => (task.id === taskId ? { ...task, ...updates } : task))
    );
  };

  const addTaskOption = (taskId: string) => {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== taskId) return task;
        return {
          ...task,
          fieldOptions: [
            ...task.fieldOptions,
            createSelectOption(`Option ${task.fieldOptions.length + 1}`),
          ],
        };
      })
    );
  };

  const updateTaskOption = (
    taskId: string,
    optionId: string,
    updates: Partial<TaskSelectOption>,
  ) => {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== taskId) return task;
        const fieldOptions = task.fieldOptions.map((option) =>
          option.id === optionId ? { ...option, ...updates } : option,
        );
        return { ...task, fieldOptions };
      })
    );
  };

  const removeTaskOption = (taskId: string, optionId: string) => {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== taskId) return task;
        return {
          ...task,
          fieldOptions: task.fieldOptions.filter((option) => option.id !== optionId),
        };
      })
    );
  };

  const removeTask = (taskId: string) => {
    setTasks((prev) =>
      prev
        .filter((task) => task.id !== taskId)
        .map((task) => ({
          ...task,
          dependsOn: task.dependsOn.filter((depId) => depId !== taskId),
        }))
    );
  };

  const toggleDependency = (taskId: string, dependencyId: string, enabled: boolean) => {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== taskId) return task;
        const next = new Set(task.dependsOn);
        if (enabled) {
          if (dependencyId !== taskId) {
            next.add(dependencyId);
          }
        } else {
          next.delete(dependencyId);
        }
        return { ...task, dependsOn: Array.from(next) };
      })
    );
  };

  const applyTemplate = (taskId: string, templateKey: string) => {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== taskId) return task;
        if (!templateKey || templateKey === 'none') {
          return {
            ...task,
            templateKey: null,
            fieldType: 'none',
            fieldLabel: '',
            fieldPlaceholder: '',
            fieldHelpText: '',
            fieldRequired: false,
            fieldAccept: '',
            fieldOptions: [],
            shareAssigneeContact: false,
          };
        }
        if (templateKey === 'custom') {
          return {
            ...task,
            templateKey: 'custom',
            fieldType: task.fieldType === 'none' ? 'text' : task.fieldType,
          };
        }
        const template = FIELD_TEMPLATES.find((tpl) => tpl.key === templateKey);
        if (!template) {
          return { ...task, templateKey };
        }
        return applyTemplateToTask(task, template, prev);
      })
    );
  };

  const createWorkflow = async () => {
    if (!name.trim()) {
      alert('Name is required');
      return;
    }
    try {
      const { functions } = await ensureFirebase();
      const callable = httpsCallable(functions, 'admin_createWorkflow');
      const payloadTasks = serializeTasksForSave(tasks);
      await callable({
        name: name.trim(),
        description: description.trim(),
        tasks: payloadTasks,
      });
      await loadWorkflows();
      setName('');
      setDescription('');
      setTasks([]);
    } catch (err: any) {
      console.error(err);
      alert(err?.message || 'Error creating workflow');
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
      const { functions } = await ensureFirebase();
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
      const { functions } = await ensureFirebase();
      const callable = httpsCallable(functions, 'admin_deleteWorkflow');
      await callable({ workflowId: id });
      setWorkflows(workflows.filter((w) => w.id !== id));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error deleting workflow');
    }
  };

  if (guardLoading || loading) return <p>Loading…</p>;
  if (!allowed) return <p>You do not have permission to manage workflows.</p>;
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
          {tasks.length === 0 ? (
            <p className="text-sm text-gray-600">
              Add workflow tasks to guide the client and internal team through delivery.
            </p>
          ) : (
            tasks.map((task, index) => {
              const dependencyCandidates = tasks.filter((candidate) => candidate.id !== task.id);
              return (
                <div key={task.id} className="border p-3 rounded-md grid gap-3 bg-gray-50">
                  <div className="flex justify-between items-center">
                    <p className="font-medium">Task {index + 1}</p>
                    <button className="text-red-600 text-sm" onClick={() => removeTask(task.id)}>
                      Remove
                    </button>
                  </div>
                  <input
                    type="text"
                    className="input"
                    placeholder="Title"
                    value={task.title}
                    onChange={(e) => updateTask(task.id, { title: e.target.value })}
                  />
                  <textarea
                    className="input"
                    placeholder="Description"
                    value={task.description}
                    onChange={(e) => updateTask(task.id, { description: e.target.value })}
                  />
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      type="number"
                      className="input"
                      placeholder="Due days (offset)"
                      value={task.dueDays}
                      onChange={(e) => updateTask(task.id, { dueDays: e.target.value })}
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={task.forCustomer}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          updateTask(task.id, {
                            forCustomer: checked,
                            fieldType:
                              checked && task.fieldType === 'none'
                                ? 'text'
                                : task.fieldType,
                          });
                        }}
                      />
                      Client task
                    </label>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="grid gap-1">
                      <label className="text-sm font-medium">Field template</label>
                      <select
                        className="input"
                        value={task.templateKey ?? ''}
                        onChange={(e) => applyTemplate(task.id, e.target.value)}
                      >
                        <option value="">Choose a preset…</option>
                        {FIELD_TEMPLATES.map((template) => (
                          <option key={template.key} value={template.key}>
                            {template.label}
                          </option>
                        ))}
                        <option value="custom">Custom field</option>
                        <option value="none">No preset</option>
                      </select>
                    </div>
                    <div className="grid gap-1">
                      <label className="text-sm font-medium">Response type</label>
                      <select
                        className="input"
                        value={task.fieldType}
                        onChange={(e) => {
                          const nextType = e.target.value as TaskFieldType;
                          const nextOptions =
                            nextType === 'select'
                              ? task.fieldOptions.length > 0
                                ? task.fieldOptions
                                : [createSelectOption('Option 1'), createSelectOption('Option 2')]
                              : [];
                          updateTask(task.id, {
                            fieldType: nextType,
                            fieldOptions: nextOptions,
                            templateKey:
                              task.templateKey && task.templateKey !== 'custom'
                                ? 'custom'
                                : task.templateKey,
                          });
                        }}
                      >
                        {FIELD_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {task.fieldType !== 'none' && (
                    <div className="grid gap-2">
                      <div className="grid gap-1">
                        <label className="text-sm font-medium">Field label</label>
                        <input
                          className="input"
                          placeholder="Label shown in the portal"
                          value={task.fieldLabel}
                          onChange={(e) => updateTask(task.id, { fieldLabel: e.target.value })}
                        />
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={task.fieldRequired}
                          onChange={(e) => updateTask(task.id, { fieldRequired: e.target.checked })}
                        />
                        Required to complete
                      </label>
                      <input
                        className="input"
                        placeholder="Placeholder (optional)"
                        value={task.fieldPlaceholder}
                        onChange={(e) => updateTask(task.id, { fieldPlaceholder: e.target.value })}
                      />
                      <textarea
                        className="input"
                        placeholder="Helper text or instructions"
                        value={task.fieldHelpText}
                        onChange={(e) => updateTask(task.id, { fieldHelpText: e.target.value })}
                      />
                      {task.fieldType === 'file' && (
                        <input
                          className="input"
                          placeholder="Accepted file types e.g. .pdf,image/*"
                          value={task.fieldAccept}
                          onChange={(e) => updateTask(task.id, { fieldAccept: e.target.value })}
                        />
                      )}
                    </div>
                  )}
                  {task.fieldType === 'select' && (
                    <div className="grid gap-2">
                      <p className="text-sm font-medium">Options</p>
                      {task.fieldOptions.map((option) => (
                        <div key={option.id} className="flex flex-col gap-2 sm:flex-row">
                          <input
                            className="input flex-1"
                            placeholder="Option label"
                            value={option.label}
                            onChange={(e) => updateTaskOption(task.id, option.id, { label: e.target.value })}
                          />
                          <input
                            className="input flex-1"
                            placeholder="Option value (optional)"
                            value={option.value}
                            onChange={(e) => updateTaskOption(task.id, option.id, { value: e.target.value })}
                          />
                          <button
                            type="button"
                            className="btn btn-sm sm:w-auto"
                            onClick={() => removeTaskOption(task.id, option.id)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button type="button" className="btn btn-sm w-fit" onClick={() => addTaskOption(task.id)}>
                        Add option
                      </button>
                    </div>
                  )}
                  {task.fieldType === 'team-member' && (
                    <div className="grid gap-2">
                      <p className="text-sm font-medium">Who are we assigning?</p>
                      <div className="flex flex-wrap gap-3 text-sm">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`assignment-${task.id}`}
                            value="team"
                            checked={task.assignmentScope === 'team'}
                            onChange={() => updateTask(task.id, { assignmentScope: 'team' })}
                          />
                          Team member
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`assignment-${task.id}`}
                            value="contractor"
                            checked={task.assignmentScope === 'contractor'}
                            onChange={() => updateTask(task.id, { assignmentScope: 'contractor' })}
                          />
                          Contractor
                        </label>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={task.shareAssigneeContact}
                          onChange={(e) => updateTask(task.id, { shareAssigneeContact: e.target.checked })}
                        />
                        Share the selected person’s email & phone with coordinators
                      </label>
                    </div>
                  )}
                  {dependencyCandidates.length > 0 && (
                    <div className="grid gap-1">
                      <p className="text-sm font-medium">Depends on</p>
                      <div className="flex flex-wrap gap-3">
                        {dependencyCandidates.map((candidate) => {
                          const candidateIndex = tasks.findIndex((t) => t.id === candidate.id);
                          const label = candidate.title
                            ? `${candidateIndex + 1}. ${candidate.title}`
                            : `Task ${candidateIndex + 1}`;
                          return (
                            <label
                              key={candidate.id}
                              className="flex items-center gap-2 text-xs sm:text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={task.dependsOn.includes(candidate.id)}
                                onChange={(e) => toggleDependency(task.id, candidate.id, e.target.checked)}
                              />
                              {label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
          <button className="btn-sm w-fit" onClick={addTask}>Add Task</button>
        </div>
        <button className="btn w-fit" onClick={createWorkflow}>Create Workflow</button>
      </div>
      {/* Workflows list */}
      <div>
        <h2 className="font-semibold mb-2">Existing Workflows</h2>
        {workflows.length === 0 ? <p>No workflows.</p> : (
          <div className="grid gap-3">
            {workflows.map((wf) => {
              const tasksList: any[] = Array.isArray(wf.tasks) ? wf.tasks : [];
              const taskKey = (task: any, idx: number) =>
                typeof task?.id === 'string' && task.id.trim().length > 0
                  ? task.id
                  : `index-${idx}`;
              const dependencyLabels = new Map<string, string>();
              tasksList.forEach((task, taskIndex) => {
                const key = taskKey(task, taskIndex);
                const labelTitle =
                  typeof task?.title === 'string' && task.title.trim().length > 0
                    ? task.title.trim()
                    : 'Untitled task';
                dependencyLabels.set(key, `${taskIndex + 1}. ${labelTitle}`);
              });
              return (
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
                      <p className="text-sm">Tasks: {tasksList.length}</p>
                      {tasksList.length > 0 && (
                        <div className="ml-3 border-l pl-3 space-y-2">
                          {tasksList.map((t: any, idx: number) => {
                            const key = taskKey(t, idx);
                            const title =
                              typeof t?.title === 'string' && t.title.trim().length > 0
                                ? t.title.trim()
                                : 'Untitled task';
                            const dueDays =
                              typeof t?.dueDays === 'string' && t.dueDays.trim().length > 0
                                ? t.dueDays.trim()
                                : typeof t?.dueDays === 'number'
                                  ? String(t.dueDays)
                                  : '';
                            const audience = t?.forCustomer ? 'Client' : 'Internal';
                            const rawType =
                              typeof t?.fieldType === 'string' && t.fieldType.trim().length > 0
                                ? t.fieldType.trim()
                                : typeof t?.responseType === 'string'
                                  ? t.responseType
                                  : null;
                            const typeLabel = rawType && rawType !== 'none'
                              ? rawType === 'team-member'
                                ? `Assignment (${(t?.assignmentScope || 'team') as string})`
                                : `Field: ${rawType}`
                              : null;
                            const fieldLabel =
                              typeof t?.fieldLabel === 'string' && t.fieldLabel.trim().length > 0
                                ? t.fieldLabel.trim()
                                : null;
                            const dependsOn: string[] = Array.isArray(t?.dependsOn) ? t.dependsOn : [];
                            const dependencyText = dependsOn
                              .map((depId) =>
                                typeof depId === 'string'
                                  ? dependencyLabels.get(depId) || depId
                                  : null,
                              )
                              .filter(Boolean)
                              .join(', ');
                            return (
                              <div key={key} className="text-sm text-gray-600 space-y-1">
                                <p>
                                  {idx + 1}. {title}
                                  {dueDays ? ` (due +${dueDays}d)` : ''} – {audience}
                                </p>
                                {typeLabel && (
                                  <p className="text-xs text-gray-500">
                                    {typeLabel}
                                    {fieldLabel ? ` · ${fieldLabel}` : ''}
                                  </p>
                                )}
                                {dependencyText && (
                                  <p className="text-xs text-gray-500">Depends on: {dependencyText}</p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex gap-2 pt-2">
                        <button className="btn-sm" onClick={() => startEdit(wf)}>Edit</button>
                        <button className="btn-sm text-red-600" onClick={() => deleteWorkflow(wf.id)}>Delete</button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}