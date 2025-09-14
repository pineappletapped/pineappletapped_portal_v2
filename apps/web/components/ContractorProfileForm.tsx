"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

interface ProfileForm {
  name: string;
  address: string;
  skills: string;
  bio: string;
  location: string;
  kit: string;
  emergencyContact: string;
  medicalIssues: string;
}

export default function ContractorProfileForm() {
  const [form, setForm] = useState<ProfileForm>({
    name: "",
    address: "",
    skills: "",
    bio: "",
    location: "",
    kit: "",
    emergencyContact: "",
    medicalIssues: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const data: any = snap.data();
        const info = data?.contractorInfo || {};
        setForm({
          name: info.name || "",
          address: info.address || "",
          skills: info.skills || "",
          bio: info.bio || "",
          location: info.location || "",
          kit: info.kit || "",
          emergencyContact: info.emergencyContact || "",
          medicalIssues: info.medicalIssues || "",
        });
      } catch (err) {
        console.warn("Failed to load profile", err);
      }
      setLoading(false);
    })();
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setSaved(false);
  };

  const handleSubmit = async () => {
    const user = auth.currentUser;
    if (!user) return alert("You must be signed in");
    setSaving(true);
    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          contractorInfo: {
            ...form,
            updatedAt: new Date().toISOString(),
          },
        },
        { merge: true }
      );
      setSaved(true);
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Error saving information");
    }
    setSaving(false);
  };

  if (loading) return <p>Loading…</p>;

  return (
    <div className="max-w-lg space-y-3">
      <input
        className="input"
        name="name"
        placeholder="Full Name"
        value={form.name}
        onChange={handleChange}
      />
      <input
        className="input"
        name="address"
        placeholder="Address"
        value={form.address}
        onChange={handleChange}
      />
      <input
        className="input"
        name="skills"
        placeholder="Skills (comma-separated)"
        value={form.skills}
        onChange={handleChange}
      />
      <textarea
        className="input"
        name="bio"
        placeholder="Short bio"
        value={form.bio}
        onChange={handleChange}
      />
      <input
        className="input"
        name="location"
        placeholder="Location (city, region)"
        value={form.location}
        onChange={handleChange}
      />
      <input
        className="input"
        name="kit"
        placeholder="What kit do you have?"
        value={form.kit}
        onChange={handleChange}
      />
      <input
        className="input"
        name="emergencyContact"
        placeholder="Emergency contact details"
        value={form.emergencyContact}
        onChange={handleChange}
      />
      <input
        className="input"
        name="medicalIssues"
        placeholder="Any medical issues we need to know"
        value={form.medicalIssues}
        onChange={handleChange}
      />
      <button className="btn" onClick={handleSubmit} disabled={saving}>
        {saving ? "Saving..." : "Save"}
      </button>
      {saved && <p className="text-sm text-green-600">Saved!</p>}
    </div>
  );
}

