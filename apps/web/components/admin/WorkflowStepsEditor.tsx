"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { addDoc, collection, doc, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";

type StepField = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  profileFieldKey?: string | null;
};

type ProfileFieldGroup = "account" | "professional" | "contractor";

type ProfileFieldOption = {
  value: string;
  label: string;
  formKey: string;
  type: StepField["type"];
  group: ProfileFieldGroup;
  required?: boolean;
};

type Step = {
  id?: string;
  order: number;
  title: string;
  description: string;
  mediaUrl?: string;
  fields?: StepField[];
  agreementText?: string;
};

const PROFILE_FIELD_GROUP_LABELS: Record<ProfileFieldGroup, string> = {
  account: "Account details",
  professional: "Professional info",
  contractor: "Contractor profile",
};

const PROFILE_FIELD_GROUP_ORDER: ProfileFieldGroup[] = ["account", "professional", "contractor"];

const PROFILE_FIELD_OPTIONS: ProfileFieldOption[] = [
  {
    value: "account.fullName",
    label: "Full name",
    formKey: "fullName",
    type: "text",
    group: "account",
    required: true,
  },
  {
    value: "account.firstName",
    label: "First name",
    formKey: "firstName",
    type: "text",
    group: "account",
    required: true,
  },
  {
    value: "account.lastName",
    label: "Last name",
    formKey: "lastName",
    type: "text",
    group: "account",
    required: true,
  },
  {
    value: "account.email",
    label: "Email",
    formKey: "email",
    type: "email",
    group: "account",
    required: true,
  },
  {
    value: "account.phone",
    label: "Phone number",
    formKey: "phone",
    type: "tel",
    group: "account",
  },
  {
    value: "professional.company",
    label: "Company",
    formKey: "company",
    type: "text",
    group: "professional",
  },
  {
    value: "professional.role",
    label: "Role / Job title",
    formKey: "role",
    type: "text",
    group: "professional",
  },
  {
    value: "professional.website",
    label: "Website",
    formKey: "website",
    type: "url",
    group: "professional",
  },
  {
    value: "professional.portfolio",
    label: "Portfolio URL",
    formKey: "portfolio",
    type: "url",
    group: "professional",
  },
  {
    value: "contractor.name",
    label: "Preferred / trading name",
    formKey: "preferredName",
    type: "text",
    group: "contractor",
  },
  {
    value: "contractor.location",
    label: "Base location",
    formKey: "location",
    type: "text",
    group: "contractor",
  },
  {
    value: "contractor.address",
    label: "Address",
    formKey: "address",
    type: "text",
    group: "contractor",
  },
  {
    value: "contractor.bio",
    label: "Bio",
    formKey: "bio",
    type: "textarea",
    group: "contractor",
  },
  {
    value: "contractor.skills",
    label: "Key skills",
    formKey: "skills",
    type: "textarea",
    group: "contractor",
  },
  {
    value: "contractor.kit",
    label: "Equipment / kit list",
    formKey: "kit",
    type: "textarea",
    group: "contractor",
  },
  {
    value: "contractor.emergencyContact",
    label: "Emergency contact",
    formKey: "emergencyContact",
    type: "text",
    group: "contractor",
  },
  {
    value: "contractor.medicalIssues",
    label: "Medical considerations",
    formKey: "medicalIssues",
    type: "text",
    group: "contractor",
  },
  {
    value: "contractor.availability",
    label: "Typical availability",
    formKey: "availability",
    type: "text",
    group: "contractor",
  },
  {
    value: "contractor.dayRate",
    label: "Day rate",
    formKey: "dayRate",
    type: "number",
    group: "contractor",
  },
];

const PROFILE_OPTION_BY_VALUE = PROFILE_FIELD_OPTIONS.reduce<Record<string, ProfileFieldOption>>((acc, option) => {
  acc[option.value] = option;
  return acc;
}, {});

const PROFILE_OPTION_BY_FORM_KEY = PROFILE_FIELD_OPTIONS.reduce<Record<string, ProfileFieldOption>>((acc, option) => {
  acc[option.formKey] = option;
  return acc;
}, {});

const FIELD_TYPES: { value: StepField["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "tel", label: "Phone" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "url", label: "URL" },
];

interface WorkflowStepsEditorProps {
  collectionPath: string;
  title?: string;
  description?: string;
  addButtonLabel?: string;
  emptyHelp?: string;
}

export default function WorkflowStepsEditor({
  collectionPath,
  title,
  description,
  addButtonLabel = "Add step",
  emptyHelp = "No steps added yet.",
}: WorkflowStepsEditorProps) {
  const [steps, setSteps] = useState<Step[]>([]);

  useEffect(() => {
    const q = query(collection(db, collectionPath), orderBy("order"));
    const unsub = onSnapshot(q, (snap) => {
      setSteps(
        snap.docs.map((docSnap) => {
          const data = docSnap.data() as Step;
          const fields = (data.fields ?? []).map((field) => {
            const optionFromValue = field.profileFieldKey ? PROFILE_OPTION_BY_VALUE[field.profileFieldKey] : undefined;
            const inferredOption = optionFromValue || PROFILE_OPTION_BY_FORM_KEY[field.key];
            return {
              ...field,
              profileFieldKey: field.profileFieldKey ?? inferredOption?.value ?? null,
              type: field.type || inferredOption?.type || "text",
            } satisfies StepField;
          });
          return { id: docSnap.id, ...data, fields } satisfies Step;
        })
      );
    });
    return () => unsub();
  }, [collectionPath]);

  const addStep = async () => {
    const order = steps.length;
    await addDoc(collection(db, collectionPath), {
      order,
      title: "New Step",
      description: "",
      fields: [],
    });
  };

  const updateStepState = (id: string | undefined, updater: (step: Step) => Step) => {
    if (!id) return;
    setSteps((prev) => prev.map((step) => (step.id === id ? updater(step) : step)));
  };

  const updateStepValue = <K extends keyof Step>(id: string | undefined, key: K, value: Step[K]) => {
    updateStepState(id, (step) => ({ ...step, [key]: value }));
  };

  const ensureUniqueFieldKey = (fields: StepField[] = [], baseKey?: string) => {
    const used = new Set(fields.map((field) => field.key));
    if (baseKey) {
      let candidate = baseKey;
      let suffix = 2;
      while (used.has(candidate)) {
        candidate = `${baseKey}${suffix}`;
        suffix += 1;
      }
      return candidate;
    }
    let counter = fields.length + 1;
    let candidate = `field${counter}`;
    while (used.has(candidate)) {
      counter += 1;
      candidate = `field${counter}`;
    }
    return candidate;
  };

  const addField = (id: string | undefined) => {
    if (!id) return;
    updateStepState(id, (step) => {
      const fields = step.fields ?? [];
      const nextKey = ensureUniqueFieldKey(fields);
      return {
        ...step,
        fields: [
          ...fields,
          { key: nextKey, label: "New field", type: "text", required: false, profileFieldKey: null },
        ],
      } satisfies Step;
    });
  };

  const setProfileField = (id: string | undefined, index: number, value: string) => {
    if (!id) return;
    updateStepState(id, (step) => {
      const fields = step.fields ?? [];
      if (!fields[index]) {
        return step;
      }
      if (!value) {
        const nextFields = fields.map((field, idx) => (idx === index ? { ...field, profileFieldKey: null } : field));
        return { ...step, fields: nextFields } satisfies Step;
      }
      const option = PROFILE_OPTION_BY_VALUE[value];
      if (!option) {
        return step;
      }
      const otherFields = fields.filter((_, idx) => idx !== index);
      const nextKey = ensureUniqueFieldKey(otherFields, option.formKey);
      const nextFields = fields.map((field, idx) => {
        if (idx !== index) return field;
        const updated: StepField = {
          ...field,
          profileFieldKey: option.value,
          key: nextKey,
          label: option.label,
          type: option.type,
        };
        if (typeof option.required === "boolean") {
          updated.required = option.required;
        }
        return updated;
      });
      return { ...step, fields: nextFields } satisfies Step;
    });
  };

  const updateField = (id: string | undefined, index: number, updates: Partial<StepField>) => {
    if (!id) return;
    updateStepState(id, (step) => {
      const fields = step.fields ?? [];
      const nextFields = fields.map((field, idx) => {
        if (idx !== index) return field;
        const nextField = { ...field, ...updates } as StepField;
        if (Object.prototype.hasOwnProperty.call(updates, "key")) {
          const keyValue = typeof nextField.key === "string" ? nextField.key : "";
          const matched = PROFILE_OPTION_BY_FORM_KEY[keyValue];
          nextField.profileFieldKey = matched ? matched.value : null;
        }
        return nextField;
      });
      return { ...step, fields: nextFields } satisfies Step;
    });
  };

  const removeField = (id: string | undefined, index: number) => {
    if (!id) return;
    updateStepState(id, (step) => {
      const fields = step.fields ?? [];
      return { ...step, fields: fields.filter((_, idx) => idx !== index) } satisfies Step;
    });
  };

  const saveStep = async (step: Step) => {
    if (!step.id) return;
    const { id, ...data } = step;
    const fields = (data.fields ?? []).map((field) => {
      const { profileFieldKey, ...rest } = field;
      const payload: Record<string, unknown> = { ...rest };
      if (profileFieldKey) {
        payload.profileFieldKey = profileFieldKey;
      }
      return payload;
    });
    await updateDoc(doc(db, collectionPath, id), {
      ...data,
      fields,
    });
  };

  return (
    <div className="space-y-6">
      {(title || description) && (
        <div className="space-y-2">
          {title && <h3 className="text-lg font-semibold text-gray-900">{title}</h3>}
          {description && <p className="text-sm text-gray-600">{description}</p>}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <button className="btn btn-primary w-full sm:w-auto" type="button" onClick={addStep}>
          {addButtonLabel}
        </button>
      </div>
      <div className="space-y-6">
        {steps.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
            {emptyHelp}
          </div>
        ) : (
          steps.map((step, idx) => (
            <div
              key={step.id || idx}
              className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="grid gap-3 sm:grid-cols-2 sm:gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700" htmlFor={`step-title-${step.id ?? idx}`}>
                    Title
                  </label>
                  <input
                    id={`step-title-${step.id ?? idx}`}
                    className="input"
                    value={step.title}
                    onChange={(event) => updateStepValue(step.id, "title", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-gray-700"
                    htmlFor={`step-description-${step.id ?? idx}`}
                  >
                    Description
                  </label>
                  <textarea
                    id={`step-description-${step.id ?? idx}`}
                    className="input min-h-[96px]"
                    value={step.description}
                    onChange={(event) => updateStepValue(step.id, "description", event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700" htmlFor={`step-media-${step.id ?? idx}`}>
                  Media URL
                </label>
                <input
                  id={`step-media-${step.id ?? idx}`}
                  className="input"
                  value={step.mediaUrl ?? ""}
                  onChange={(event) => updateStepValue(step.id, "mediaUrl", event.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Paste a hosted image or video link to enrich the step with supporting visuals.
                </p>
              </div>
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <h4 className="text-base font-semibold text-gray-900">Fields</h4>
                    <p className="text-sm text-gray-600">
                      Map inputs to saved profile details or craft custom questions for applicants.
                    </p>
                  </div>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => addField(step.id)}>
                    Add field
                  </button>
                </div>
                {step.fields && step.fields.length > 0 ? (
                  <div className="space-y-4">
                    {step.fields.map((field, fieldIndex) => {
                      const hasPresetType = FIELD_TYPES.some((option) => option.value === field.type);
                      const selectedProfileField = field.profileFieldKey && PROFILE_OPTION_BY_VALUE[field.profileFieldKey]
                        ? field.profileFieldKey
                        : PROFILE_OPTION_BY_FORM_KEY[field.key]?.value ?? "";
                      return (
                        <div
                          key={`${step.id}-field-${fieldIndex}`}
                          className="space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4"
                        >
                          <div className="space-y-2">
                            <label
                              className="text-sm font-medium text-gray-700"
                              htmlFor={`field-profile-${step.id}-${fieldIndex}`}
                            >
                              Profile field mapping
                            </label>
                            <select
                              id={`field-profile-${step.id}-${fieldIndex}`}
                              className="input"
                              value={selectedProfileField}
                              onChange={(event) => setProfileField(step.id, fieldIndex, event.target.value)}
                            >
                              <option value="">Custom field</option>
                              {PROFILE_FIELD_GROUP_ORDER.map((group) => (
                                <optgroup key={group} label={PROFILE_FIELD_GROUP_LABELS[group]}>
                                  {PROFILE_FIELD_OPTIONS.filter((option) => option.group === group).map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                            <p className="text-xs text-gray-500">
                              Selecting a saved profile field will prefill the key, label, and input type.
                            </p>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                              <label className="text-sm font-medium text-gray-700" htmlFor={`field-key-${step.id}-${fieldIndex}`}>
                                Field key
                              </label>
                              <input
                                id={`field-key-${step.id}-${fieldIndex}`}
                                className="input"
                                value={field.key}
                                onChange={(event) => updateField(step.id, fieldIndex, { key: event.target.value })}
                              />
                            </div>
                            <div className="space-y-2">
                              <label
                                className="text-sm font-medium text-gray-700"
                                htmlFor={`field-label-${step.id}-${fieldIndex}`}
                              >
                                Field label
                              </label>
                              <input
                                id={`field-label-${step.id}-${fieldIndex}`}
                                className="input"
                                value={field.label}
                                onChange={(event) => updateField(step.id, fieldIndex, { label: event.target.value })}
                              />
                            </div>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                            <div className="space-y-2">
                              <label
                                className="text-sm font-medium text-gray-700"
                                htmlFor={`field-type-${step.id}-${fieldIndex}`}
                              >
                                Field type
                              </label>
                              <select
                                id={`field-type-${step.id}-${fieldIndex}`}
                                className="input"
                                value={field.type}
                                onChange={(event) => updateField(step.id, fieldIndex, { type: event.target.value })}
                              >
                                {!hasPresetType && field.type ? <option value={field.type}>{field.type}</option> : null}
                                {FIELD_TYPES.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                              <input
                                type="checkbox"
                                checked={Boolean(field.required)}
                                onChange={(event) => updateField(step.id, fieldIndex, { required: event.target.checked })}
                              />
                              Required field
                            </label>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm text-rose-600 hover:text-rose-700"
                            onClick={() => removeField(step.id, fieldIndex)}
                          >
                            Remove field
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500">
                    No fields added yet.
                  </div>
                )}
              </div>
              {step.agreementText !== undefined && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700" htmlFor={`agreement-${step.id ?? idx}`}>
                    Agreement text
                  </label>
                  <textarea
                    id={`agreement-${step.id ?? idx}`}
                    className="input min-h-[120px]"
                    value={step.agreementText}
                    onChange={(event) => updateStepValue(step.id, "agreementText", event.target.value)}
                  />
                </div>
              )}
              <div className="flex justify-end">
                <button className="btn btn-primary btn-sm" type="button" onClick={() => saveStep(step)}>
                  Save step
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
