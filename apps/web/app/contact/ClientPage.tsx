"use client";

import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import Link from 'next/link';

export default function ContactClientPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const callable = httpsCallable(functions, 'contact_send');
    setStatus('sending');
    try {
      await callable({ name, email, company, message });
      setStatus('sent');
      setName('');
      setEmail('');
      setCompany('');
      setMessage('');
    } catch (err) {
      console.error(err);
      alert('Failed to send message');
      setStatus('idle');
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-12 px-4 grid gap-8">
      <h1 className="text-3xl font-bold text-center">Get in Touch</h1>
      <form onSubmit={submit} className="grid gap-4 bg-white/70 backdrop-blur p-6 rounded shadow">
        <input
          className="input"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className="input"
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          placeholder="Company name"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
        <textarea
          className="input"
          placeholder="How can we help?"
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
        />
        <button type="submit" className="btn" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Sent!' : 'Send Message'}
        </button>
      </form>
      <div className="text-center">
        <Link href="/request-quote" className="btn-sm">
          Request Quote
        </Link>
      </div>
    </div>
  );
}
