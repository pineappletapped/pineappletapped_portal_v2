"use client";

import { generateFormId } from "@/lib/forms";
import { useCallback } from "react";

export type OrderFormFieldInputType = "short-text" | "long-text";

export interface OrderFormFieldFormState {
  id: string;
  label: string;
  description: string;
  required: boolean;
  type: OrderFormFieldInputType;
}

interface Props {
  fields: OrderFormFieldFormState[];
  onChange: (fields: OrderFormFieldFormState[]) => void;
}

const createField = (): OrderFormFieldFormState => ({
  id: generateFormId(),
  label: "",
  description: "",
  required: false,
  type: "short-text",
});

const typeOptions: { value: OrderFormFieldInputType; label: string }[] = [
  { value: "short-text", label: "Short text" },
  { value: "long-text", label: "Paragraph" },
];

export default function ProductOrderFieldsEditor({ fields, onChange }: Props) {
  const addField = useCallback(() => {
    onChange([...fields, createField()]);
  }, [fields, onChange]);

  const updateField = useCallback(
    (index: number, patch: Partial<OrderFormFieldFormState>) => {
      onChange(
        fields.map((field, i) => (i === index ? { ...field, ...patch } : field))
      );
    },
    [fields, onChange]
  );

  const removeField = useCallback(
    (index: number) => {
      onChange(fields.filter((_, i) => i !== index));
    },
    [fields, onChange]
  );

  const moveField = useCallback(
    (index: number, delta: -1 | 1) => {
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= fields.length) {
        return;
      }
      const next = [...fields];
      const [entry] = next.splice(index, 1);
      next.splice(nextIndex, 0, entry);
      onChange(next);
    },
    [fields, onChange]
  );

  return (
    <div className="space-y-4">
      {fields.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          <p>No custom questions configured yet.</p>
          <p className="mt-2">
            Add prompts to collect extra booking details like stand numbers or
            campaign goals when customers add this product to their cart.
          </p>
          <button type="button" className="btn btn-sm mt-4" onClick={addField}>
            Add question
          </button>
        </div>
      ) : (
        <>
          {fields.map((field, index) => {
            const id = `order-field-${field.id}`;
            const descriptionId = `${id}-help`;
            return (
              <div key={field.id} className="space-y-4 rounded-md border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Question {index + 1}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Shown during checkout before the customer selects their production date.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => moveField(index, -1)}
                      disabled={index === 0}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => moveField(index, 1)}
                      disabled={index === fields.length - 1}
                    >
                      Move down
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-red-600"
                      onClick={() => removeField(index)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div>
                  <label htmlFor={id} className="block text-sm font-medium text-slate-900">
                    Field label
                  </label>
                  <input
                    id={id}
                    type="text"
                    className="input input-bordered mt-1 w-full"
                    value={field.label}
                    onChange={(event) => updateField(index, { label: event.target.value })}
                    placeholder="e.g. Exhibition stand number"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`${id}-description`}
                    className="block text-sm font-medium text-slate-900"
                  >
                    Helper text (optional)
                  </label>
                  <textarea
                    id={`${id}-description`}
                    className="textarea textarea-bordered mt-1 w-full"
                    value={field.description}
                    onChange={(event) =>
                      updateField(index, { description: event.target.value })
                    }
                    placeholder="Provide guidance for the team reviewing this booking."
                  />
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div>
                    <label
                      htmlFor={`${id}-type`}
                      className="block text-sm font-medium text-slate-900"
                    >
                      Response type
                    </label>
                    <select
                      id={`${id}-type`}
                      className="select select-bordered mt-1"
                      value={field.type}
                      onChange={(event) =>
                        updateField(index, {
                          type: event.target.value as OrderFormFieldInputType,
                        })
                      }
                    >
                      {typeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={field.required}
                      onChange={(event) =>
                        updateField(index, { required: event.target.checked })
                      }
                      aria-describedby={descriptionId}
                    />
                    Required response
                  </label>
                  <span id={descriptionId} className="text-xs text-slate-500">
                    Required questions must be answered before the product can be added to the cart.
                  </span>
                </div>
              </div>
            );
          })}
          <div>
            <button type="button" className="btn btn-sm" onClick={addField}>
              Add another question
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export { createField as createOrderFormField };
