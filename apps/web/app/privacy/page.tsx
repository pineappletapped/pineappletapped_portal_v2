import Link from 'next/link';

export const metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <div className="prose max-w-3xl mx-auto py-8">
      <h1>Privacy Policy</h1>
      <p>
        We respect your privacy and are committed to protecting your personal information. This page outlines how Pineapple Tapped
        collects, uses, and safeguards data across our services.
      </p>
      <p>
        For questions about this policy, please <Link href="/contact" className="text-brand-orange underline">contact us</Link>.
      </p>
    </div>
  );
}
