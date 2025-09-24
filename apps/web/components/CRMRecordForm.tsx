"use client";
import { useState } from 'react';

interface ProductOption {
  id: string;
  name: string;
}

interface Props {
  status: 'client' | 'prospect' | 'outreach';
  onSave: (data: any) => void;
  onClose: () => void;
  products?: ProductOption[];
}

export default function CRMRecordForm({ status, onSave, onClose, products = [] }: Props) {
  const [tab, setTab] = useState<'organisation' | 'contact' | 'branding' | 'log' | 'projects'>('organisation');
  const [form, setForm] = useState<any>({});

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, files } = e.target;
    if (files && files[0]) {
      setForm({ ...form, [name]: files[0] });
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
  };

  const tabButton = (id: typeof tab, label: string) => (
    <button
      type="button"
      className={`pb-2 ${tab === id ? 'border-b-2 border-orange font-medium' : ''}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded w-full max-w-lg">
        <h2 className="text-lg font-semibold mb-4">New {status.charAt(0).toUpperCase() + status.slice(1)}</h2>
        <div className="flex gap-4 border-b mb-4">
          {tabButton('organisation', 'Organisation')}
          {tabButton('contact', 'Contact')}
          {tabButton('branding', 'Branding')}
          {tabButton('log', 'Contact Log')}
          {tabButton('projects', 'Projects')}
        </div>
        <div className="h-96 overflow-y-auto">
          <form className="grid gap-4" onSubmit={submit}>
          <div className={tab === 'organisation' ? 'grid gap-2' : 'hidden'}>
            <input
              name="organisation"
              placeholder="Organisation Name"
              className="border p-2"
              value={form.organisation || ''}
              onChange={handleChange}
            />
            <input
              name="website"
              placeholder="Website"
              className="border p-2"
              value={form.website || ''}
              onChange={handleChange}
            />
            <input
              name="location"
              placeholder="Location"
              className="border p-2"
              value={form.location || ''}
              onChange={handleChange}
            />
            <input
              name="address"
              placeholder="Address"
              className="border p-2"
              value={form.address || ''}
              onChange={handleChange}
            />
            <textarea
              name="socials"
              placeholder="Social Profiles"
              className="border p-2"
              value={form.socials || ''}
              onChange={handleChange}
            />
          </div>

          <div className={tab === 'contact' ? 'grid gap-2' : 'hidden'}>
            <input
              name="fullName"
              placeholder="Full Name"
              className="border p-2"
              value={form.fullName || ''}
              onChange={handleChange}
            />
            <input
              name="position"
              placeholder="Position"
              className="border p-2"
              value={form.position || ''}
              onChange={handleChange}
            />
            <input
              name="email"
              placeholder="Email"
              type="email"
              className="border p-2"
              value={form.email || ''}
              onChange={handleChange}
            />
            <input
              name="phone"
              placeholder="Phone"
              className="border p-2"
              value={form.phone || ''}
              onChange={handleChange}
            />
          </div>

          <div className={tab === 'branding' ? 'grid gap-2' : 'hidden'}>
            <div>
              <label className="block text-sm">Primary Logo</label>
              <input type="file" name="primaryLogo" onChange={handleFileChange} />
              {form.primaryLogo && <p className="text-xs">{form.primaryLogo.name}</p>}
            </div>
            <div>
              <label className="block text-sm">Secondary Logo</label>
              <input type="file" name="secondaryLogo" onChange={handleFileChange} />
              {form.secondaryLogo && <p className="text-xs">{form.secondaryLogo.name}</p>}
            </div>
            <div className="flex gap-2">
              <div>
                <label className="block text-sm">Primary Colour</label>
                <input
                  type="color"
                  name="primaryColour"
                  value={form.primaryColour || '#000000'}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block text-sm">Secondary Colour 1</label>
                <input
                  type="color"
                  name="secondaryColour1"
                  value={form.secondaryColour1 || '#000000'}
                  onChange={handleChange}
                />
              </div>
              <div>
                <label className="block text-sm">Secondary Colour 2</label>
                <input
                  type="color"
                  name="secondaryColour2"
                  value={form.secondaryColour2 || '#000000'}
                  onChange={handleChange}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm">Brand Guidelines</label>
              <input type="file" name="brandGuidelines" onChange={handleFileChange} />
              {form.brandGuidelines && <p className="text-xs">{form.brandGuidelines.name}</p>}
            </div>
            <div>
              <input
                name="primaryFontName"
                placeholder="Primary Font Name"
                className="border p-2 mb-1"
                value={form.primaryFontName || ''}
                onChange={handleChange}
              />
              <input type="file" name="primaryFontFile" onChange={handleFileChange} />
              {form.primaryFontFile && <p className="text-xs">{form.primaryFontFile.name}</p>}
            </div>
            <div>
              <input
                name="secondaryFontName"
                placeholder="Secondary Font Name"
                className="border p-2 mb-1"
                value={form.secondaryFontName || ''}
                onChange={handleChange}
              />
              <input type="file" name="secondaryFontFile" onChange={handleFileChange} />
              {form.secondaryFontFile && <p className="text-xs">{form.secondaryFontFile.name}</p>}
            </div>
          </div>

          <div className={tab === 'log' ? 'grid gap-2' : 'hidden'}>
            <textarea
              name="notes"
              placeholder="Contact notes"
              className="border p-2"
              value={form.notes || ''}
              onChange={handleChange}
            />
          </div>

          <div className={tab === 'projects' ? 'grid gap-2' : 'hidden'}>
            {status === 'outreach' && (
              <div className="grid gap-1">
                <label className="text-sm font-medium" htmlFor="suggestedProductId">
                  Suggested Product
                </label>
                <select
                  id="suggestedProductId"
                  name="suggestedProductId"
                  className="border p-2"
                  value={form.suggestedProductId || ''}
                  onChange={handleChange}
                >
                  <option value="">Select a product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <textarea
              name="projects"
              placeholder="Project details"
              className="border p-2"
              value={form.projects || ''}
              onChange={handleChange}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-sm">Save</button>
          </div>
          </form>
        </div>
      </div>
    </div>
  );
}
