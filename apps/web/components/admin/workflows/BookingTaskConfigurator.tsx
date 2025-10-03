"use client";

export type BookingResponseFieldType = 'text' | 'textarea' | 'email' | 'phone' | 'website';

export interface BookingSlotTemplate {
  id: string;
  label: string;
  startAt: string;
  endAt: string;
  capacity: number;
  priceClass: string;
  notes: string;
}

export interface BookingResponseField {
  id: string;
  type: BookingResponseFieldType;
  label: string;
  placeholder: string;
  required: boolean;
}

export interface BookingUploadRequirement {
  id: string;
  label: string;
  description: string;
  accept: string;
  required: boolean;
}

export interface BookingAgreementCopy {
  heading: string;
  body: string;
  acknowledgementLabel: string;
  requireSignature: boolean;
}

export interface BookingTaskConfig {
  templateId: string;
  introduction: string;
  slots: BookingSlotTemplate[];
  responseFields: BookingResponseField[];
  uploadRequirements: BookingUploadRequirement[];
  agreement: BookingAgreementCopy;
}

const randomId = () =>
  typeof globalThis !== 'undefined' &&
  globalThis.crypto &&
  typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const RESPONSE_TYPE_OPTIONS: { value: BookingResponseFieldType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Paragraph' },
  { value: 'email', label: 'Email address' },
  { value: 'phone', label: 'Phone number' },
  { value: 'website', label: 'Website URL' },
];

const PRICE_CLASS_SUGGESTIONS = ['included', 'billable', 'premium', 'sponsored'];

export const createDefaultBookingConfig = (taskId: string): BookingTaskConfig => ({
  templateId: `booking-${taskId}`,
  introduction:
    'Invite participants to reserve their filming slot. Everyone will receive confirmation and reminders automatically.',
  slots: [],
  responseFields: [
    {
      id: randomId(),
      type: 'text',
      label: 'Business or participant name',
      placeholder: 'Trading name or organisation',
      required: true,
    },
    {
      id: randomId(),
      type: 'email',
      label: 'Primary contact email',
      placeholder: 'name@example.com',
      required: true,
    },
  ],
  uploadRequirements: [
    {
      id: randomId(),
      label: 'Company logo',
      description: 'Upload a high-resolution PNG, SVG or EPS file for marketing collateral.',
      accept: '.png,.svg,.eps,.ai,.pdf,image/*',
      required: false,
    },
  ],
  agreement: {
    heading: 'Participation agreement',
    body: '',
    acknowledgementLabel: 'I agree to the filming terms and conditions',
    requireSignature: true,
  },
});

interface BookingTaskConfiguratorProps {
  value: BookingTaskConfig;
  onChange: (value: BookingTaskConfig) => void;
}

export default function BookingTaskConfigurator({ value, onChange }: BookingTaskConfiguratorProps) {
  const addSlot = () => {
    onChange({
      ...value,
      slots: [
        ...value.slots,
        {
          id: randomId(),
          label: `Slot ${value.slots.length + 1}`,
          startAt: '',
          endAt: '',
          capacity: 1,
          priceClass: 'included',
          notes: '',
        },
      ],
    });
  };

  const updateSlot = (slotId: string, updates: Partial<BookingSlotTemplate>) => {
    onChange({
      ...value,
      slots: value.slots.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              ...updates,
            }
          : slot,
      ),
    });
  };

  const removeSlot = (slotId: string) => {
    onChange({
      ...value,
      slots: value.slots.filter((slot) => slot.id !== slotId),
    });
  };

  const addResponseField = () => {
    onChange({
      ...value,
      responseFields: [
        ...value.responseFields,
        {
          id: randomId(),
          type: 'text',
          label: 'Additional information',
          placeholder: '',
          required: false,
        },
      ],
    });
  };

  const updateResponseField = (fieldId: string, updates: Partial<BookingResponseField>) => {
    onChange({
      ...value,
      responseFields: value.responseFields.map((field) =>
        field.id === fieldId
          ? {
              ...field,
              ...updates,
            }
          : field,
      ),
    });
  };

  const removeResponseField = (fieldId: string) => {
    onChange({
      ...value,
      responseFields: value.responseFields.filter((field) => field.id !== fieldId),
    });
  };

  const addUploadRequirement = () => {
    onChange({
      ...value,
      uploadRequirements: [
        ...value.uploadRequirements,
        {
          id: randomId(),
          label: 'Supporting asset',
          description: 'Upload any supporting material for this booking.',
          accept: '',
          required: false,
        },
      ],
    });
  };

  const updateUploadRequirement = (requirementId: string, updates: Partial<BookingUploadRequirement>) => {
    onChange({
      ...value,
      uploadRequirements: value.uploadRequirements.map((requirement) =>
        requirement.id === requirementId
          ? {
              ...requirement,
              ...updates,
            }
          : requirement,
      ),
    });
  };

  const removeUploadRequirement = (requirementId: string) => {
    onChange({
      ...value,
      uploadRequirements: value.uploadRequirements.filter((requirement) => requirement.id !== requirementId),
    });
  };

  return (
    <div className="grid gap-4 rounded-md border border-emerald-200 bg-emerald-50/60 p-4">
      <p className="text-sm font-medium text-emerald-900">
        Configure booking slots, participant questions, and agreement copy. Participants will pick a slot and submit the
        requested details before the project task is marked complete.
      </p>

      <label className="grid gap-1">
        <span className="text-sm font-medium text-emerald-900">Introduction</span>
        <textarea
          className="textarea textarea-bordered"
          rows={3}
          value={value.introduction}
          onChange={(event) => onChange({ ...value, introduction: event.target.value })}
          placeholder="Explain what participants should expect when they reserve a slot."
        />
      </label>

      <section className="grid gap-3">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-emerald-900">Available slots</p>
            <p className="text-xs text-emerald-700">
              Provide the filming sessions attendees can book. Each slot can include capacity limits and a price class for reporting.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-xs" onClick={addSlot}>
            Add slot
          </button>
        </header>
        {value.slots.length === 0 ? (
          <p className="rounded-md bg-white p-3 text-sm text-emerald-700">
            No slots yet. Add at least one slot before saving this workflow task so invitees have a schedule to choose from.
          </p>
        ) : (
          <div className="space-y-3">
            {value.slots.map((slot) => (
              <div key={slot.id} className="grid gap-2 rounded-md bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-emerald-900">{slot.label || 'Unnamed slot'}</h4>
                  <button type="button" className="text-xs text-emerald-700" onClick={() => removeSlot(slot.id)}>
                    Remove
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium">Label</span>
                    <input
                      className="input input-sm"
                      placeholder="Morning session"
                      value={slot.label}
                      onChange={(event) => updateSlot(slot.id, { label: event.target.value })}
                    />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium">Capacity</span>
                    <input
                      type="number"
                      min={1}
                      className="input input-sm"
                      value={slot.capacity}
                      onChange={(event) =>
                        updateSlot(slot.id, {
                          capacity: Number.isNaN(event.target.valueAsNumber)
                            ? slot.capacity
                            : Math.max(1, Math.round(event.target.valueAsNumber)),
                        })
                      }
                    />
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium">Start</span>
                    <input
                      type="datetime-local"
                      className="input input-sm"
                      value={slot.startAt}
                      onChange={(event) => updateSlot(slot.id, { startAt: event.target.value })}
                    />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium">End</span>
                    <input
                      type="datetime-local"
                      className="input input-sm"
                      value={slot.endAt}
                      onChange={(event) => updateSlot(slot.id, { endAt: event.target.value })}
                    />
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium">Price class</span>
                    <input
                      className="input input-sm"
                      list={`price-class-${slot.id}`}
                      placeholder="included"
                      value={slot.priceClass}
                      onChange={(event) => updateSlot(slot.id, { priceClass: event.target.value })}
                    />
                    <datalist id={`price-class-${slot.id}`}>
                      {PRICE_CLASS_SUGGESTIONS.map((suggestion) => (
                        <option key={suggestion} value={suggestion} />
                      ))}
                    </datalist>
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium">Notes</span>
                    <input
                      className="input input-sm"
                      placeholder="Filming location or access notes"
                      value={slot.notes}
                      onChange={(event) => updateSlot(slot.id, { notes: event.target.value })}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-emerald-900">Participant questions</p>
            <p className="text-xs text-emerald-700">
              Configure additional questions that participants must complete after choosing a slot.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-xs" onClick={addResponseField}>
            Add question
          </button>
        </header>
        {value.responseFields.length === 0 ? (
          <p className="rounded-md bg-white p-3 text-sm text-emerald-700">
            Add at least one question to capture the information you need from each attendee.
          </p>
        ) : (
          <div className="space-y-3">
            {value.responseFields.map((field) => (
              <div key={field.id} className="grid gap-2 rounded-md bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-emerald-900">{field.label || 'Untitled question'}</h4>
                  <button type="button" className="text-xs text-emerald-700" onClick={() => removeResponseField(field.id)}>
                    Remove
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium">Label</span>
                    <input
                      className="input input-sm"
                      placeholder="Question label"
                      value={field.label}
                      onChange={(event) => updateResponseField(field.id, { label: event.target.value })}
                    />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium">Field type</span>
                    <select
                      className="select select-sm"
                      value={field.type}
                      onChange={(event) =>
                        updateResponseField(field.id, {
                          type: event.target.value as BookingResponseFieldType,
                        })
                      }
                    >
                      {RESPONSE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Placeholder</span>
                  <input
                    className="input input-sm"
                    placeholder="Hint or example text"
                    value={field.placeholder}
                    onChange={(event) => updateResponseField(field.id, { placeholder: event.target.value })}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-emerald-800">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs"
                    checked={field.required}
                    onChange={(event) => updateResponseField(field.id, { required: event.target.checked })}
                  />
                  Required
                </label>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-emerald-900">Uploads</p>
            <p className="text-xs text-emerald-700">
              Request supporting files (logos, assets, signed agreements) that the team needs before filming.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-xs" onClick={addUploadRequirement}>
            Add upload
          </button>
        </header>
        {value.uploadRequirements.length === 0 ? (
          <p className="rounded-md bg-white p-3 text-sm text-emerald-700">
            Include at least one upload requirement if you need assets before confirming a booking.
          </p>
        ) : (
          <div className="space-y-3">
            {value.uploadRequirements.map((requirement) => (
              <div key={requirement.id} className="grid gap-2 rounded-md bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-emerald-900">{requirement.label || 'Upload requirement'}</h4>
                  <button
                    type="button"
                    className="text-xs text-emerald-700"
                    onClick={() => removeUploadRequirement(requirement.id)}
                  >
                    Remove
                  </button>
                </div>
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Label</span>
                  <input
                    className="input input-sm"
                    placeholder="e.g. Risk assessment"
                    value={requirement.label}
                    onChange={(event) => updateUploadRequirement(requirement.id, { label: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="font-medium">Description</span>
                  <textarea
                    className="textarea textarea-bordered textarea-sm"
                    rows={2}
                    placeholder="Explain why this asset is required"
                    value={requirement.description}
                    onChange={(event) => updateUploadRequirement(requirement.id, { description: event.target.value })}
                  />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium">Accepted file types</span>
                    <input
                      className="input input-sm"
                      placeholder=".pdf,.jpg,.png"
                      value={requirement.accept}
                      onChange={(event) => updateUploadRequirement(requirement.id, { accept: event.target.value })}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-emerald-800">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={requirement.required}
                      onChange={(event) => updateUploadRequirement(requirement.id, { required: event.target.checked })}
                    />
                    Required before confirming slot
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <header>
          <p className="text-sm font-semibold text-emerald-900">Agreement</p>
          <p className="text-xs text-emerald-700">
            Define the terms and acknowledgement attendees must accept when booking their slot.
          </p>
        </header>
        <div className="grid gap-2">
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Heading</span>
            <input
              className="input input-sm"
              placeholder="Participation agreement"
              value={value.agreement.heading}
              onChange={(event) =>
                onChange({
                  ...value,
                  agreement: { ...value.agreement, heading: event.target.value },
                })
              }
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Body</span>
            <textarea
              className="textarea textarea-bordered textarea-sm"
              rows={4}
              placeholder="Outline the expectations, cancellation policy, and any legal obligations."
              value={value.agreement.body}
              onChange={(event) =>
                onChange({
                  ...value,
                  agreement: { ...value.agreement, body: event.target.value },
                })
              }
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Acknowledgement label</span>
            <input
              className="input input-sm"
              placeholder="I agree to the filming terms and conditions"
              value={value.agreement.acknowledgementLabel}
              onChange={(event) =>
                onChange({
                  ...value,
                  agreement: { ...value.agreement, acknowledgementLabel: event.target.value },
                })
              }
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-emerald-800">
            <input
              type="checkbox"
              className="checkbox checkbox-xs"
              checked={value.agreement.requireSignature}
              onChange={(event) =>
                onChange({
                  ...value,
                  agreement: { ...value.agreement, requireSignature: event.target.checked },
                })
              }
            />
            Require a digital signature
          </label>
        </div>
      </section>
    </div>
  );
}
