"use client";

import { useId, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';
import Link from 'next/link';
import { useLeadSourceTag } from '@/hooks/useLeadSourceTag';

export default function ContactClientPage() {
  const { value: leadSource } = useLeadSourceTag(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasErrors = Boolean(errorMessage) || validationMessages.length > 0;
  const showFeedback = status === 'sent' || hasErrors;

  const resetFeedback = () => {
    if (status === 'sent' || status === 'error') {
      setStatus('idle');
    }
    if (errorMessage) {
      setErrorMessage(null);
    }
    if (validationMessages.length) {
      setValidationMessages([]);
    }
  };

  const validateForm = () => {
    const problems: string[] = [];
    if (!name.trim()) {
      problems.push('Please enter your name.');
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      problems.push('Please enter your email address.');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      problems.push('Please provide a valid email address.');
    }
    if (!message.trim()) {
      problems.push('Let us know how we can help before sending the form.');
    }
    return problems;
  };

  const feedbackId = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problems = validateForm();
    if (problems.length) {
      setValidationMessages(problems);
      setErrorMessage(null);
      setStatus('idle');
      return;
    }

    const callable = httpsCallable(functions, 'contact_send');
    setValidationMessages([]);
    setErrorMessage(null);
    setStatus('sending');
    try {
      await callable({
        name: name.trim(),
        email: email.trim(),
        company,
        message: message.trim(),
        leadSource,
      });
      setStatus('sent');
      setName('');
      setEmail('');
      setCompany('');
      setMessage('');
    } catch (err) {
      console.error(err);
      setErrorMessage('We couldn\'t send your message just now. Please try again or email hello@pineappletapped.com.');
      setStatus('error');
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-12 px-4 grid gap-8">
      <h1 className="text-3xl font-bold text-center">Get in Touch</h1>
      {showFeedback && (
        <div
          id={feedbackId}
          aria-live={hasErrors ? 'assertive' : 'polite'}
          role={hasErrors ? 'alert' : 'status'}
          className={`rounded-md border p-4 text-sm ${
            hasErrors
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-green-200 bg-green-50 text-green-800'
          }`}
        >
          {status === 'sent' && !hasErrors && (
            <p className="font-medium">Thanks for reaching out! We&apos;ll be in touch shortly.</p>
          )}
          {hasErrors && (
            <div className="grid gap-2">
              {errorMessage && <p className="font-medium">{errorMessage}</p>}
              {validationMessages.length > 0 && (
                <ul className="list-disc space-y-1 pl-5">
                  {validationMessages.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      <form
        aria-describedby={showFeedback ? feedbackId : undefined}
        onSubmit={submit}
        className="grid gap-4 bg-white/70 backdrop-blur p-6 rounded shadow"
      >
        <input
          className="input"
          placeholder="Your name"
          value={name}
          onChange={(e) => {
            resetFeedback();
            setName(e.target.value);
          }}
          required
        />
        <input
          className="input"
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(e) => {
            resetFeedback();
            setEmail(e.target.value);
          }}
          required
        />
        <input
          className="input"
          placeholder="Company name"
          value={company}
          onChange={(e) => {
            resetFeedback();
            setCompany(e.target.value);
          }}
        />
        <textarea
          className="input"
          placeholder="How can we help?"
          rows={5}
          value={message}
          onChange={(e) => {
            resetFeedback();
            setMessage(e.target.value);
          }}
          required
        />
        <button type="submit" className="btn" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Send another message' : 'Send Message'}
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
