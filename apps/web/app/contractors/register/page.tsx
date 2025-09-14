"use client";

import { useEffect, useState } from 'react';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { useRouter } from 'next/navigation';

/**
 * Contractor Registration
 *
 * This page collects important information from a newly registered contractor.
 * Contractors provide their personal details, skills, equipment, location,
 * emergency contact, and any medical issues. After submission the data is
 * stored under their user profile and the contractor is flagged as active.
 *
 * A link to review and sign the contractor agreement is presented after
 * successful registration. Admins can edit the agreement from the Admin
 * agreements page.
 */
export default function ContractorRegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [registered, setRegistered] = useState(false);
  const [form, setForm] = useState({
    name: '',
    address: '',
    skills: '',
    bio: '',
    location: '',
    kit: '',
    emergencyContact: '',
    medicalIssues: '',
  });

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) {
        setLoading(false);
        return;
      }
      const uRef = doc(db, 'users', user.uid);
      const snap = await getDoc(uRef);
      const data: any = snap.data();
      if (data?.contractorInfo) {
        setRegistered(true);
      }
      setLoading(false);
    })();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async () => {
    const user = auth.currentUser;
    if (!user) return alert('You must be signed in');
    // basic validation
    if (!form.name.trim()) return alert('Name is required');
    try {
      const uRef = doc(db, 'users', user.uid);
      await setDoc(uRef, {
        contractor: true,
        contractorInfo: {
          name: form.name,
          address: form.address,
          skills: form.skills,
          bio: form.bio,
          location: form.location,
          kit: form.kit,
          emergencyContact: form.emergencyContact,
          medicalIssues: form.medicalIssues,
          updatedAt: new Date().toISOString(),
        },
      }, { merge: true });
      setRegistered(true);
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Error saving information');
    }
  };

  if (loading) return <p>Loading…</p>;
  if (registered) {
    return (
      <div className="max-w-lg mx-auto p-4">
        <h1 className="text-xl font-semibold mb-3">Registration Complete</h1>
        <p className="mb-4">Thank you for completing your contractor profile. Please review and sign the latest agreement below.</p>
        <button onClick={() => router.push('/agreements/contractor')} className="btn">Review Agreement</button>
      </div>
    );
  }
  return (
    <div className="max-w-lg mx-auto p-4">
      <h1 className="text-xl font-semibold mb-3">Contractor Registration</h1>
      <p className="text-sm mb-4">Please fill in your details. This information helps us manage your assignments and ensure safety on site.</p>
      <div className="grid gap-3">
        <input className="input" name="name" placeholder="Full Name" value={form.name} onChange={handleChange} />
        <input className="input" name="address" placeholder="Address" value={form.address} onChange={handleChange} />
        <input className="input" name="skills" placeholder="Skills (comma-separated)" value={form.skills} onChange={handleChange} />
        <textarea className="input" name="bio" placeholder="Short bio" value={form.bio} onChange={handleChange} />
        <input className="input" name="location" placeholder="Location (city, region)" value={form.location} onChange={handleChange} />
        <input className="input" name="kit" placeholder="What kit do you have?" value={form.kit} onChange={handleChange} />
        <input className="input" name="emergencyContact" placeholder="Emergency contact details" value={form.emergencyContact} onChange={handleChange} />
        <input className="input" name="medicalIssues" placeholder="Any medical issues we need to know" value={form.medicalIssues} onChange={handleChange} />
        <button className="btn mt-2" onClick={handleSubmit}>Submit Registration</button>
      </div>
    </div>
  );
}