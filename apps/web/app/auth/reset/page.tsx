import Link from 'next/link';

type ResetPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

const toEmail = (value?: string | string[]) => {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
};

export default function PasswordResetConfirmation({ searchParams }: ResetPageProps) {
  const email = toEmail(searchParams?.email);

  return (
    <div className="max-w-2xl mx-auto card grid gap-4">
      <h1 className="text-2xl font-semibold">Check your inbox</h1>
      <p>
        We&apos;ve sent password reset instructions
        {email ? (
          <>
            {' '}to <span className="font-medium">{email}</span>
          </>
        ) : null}
        . Follow the link in that email to choose a new password.
      </p>
      <ul className="list-disc list-inside space-y-2 text-sm">
        <li>If you don&apos;t see the email, check your spam or junk folder.</li>
        <li>
          The reset link expires after a short period. If it stops working, return to the
          login page and request another email.
        </li>
        <li>
          Need extra help? Forward the email to{' '}
          <a className="underline" href="mailto:support@pineappletapped.com">
            support@pineappletapped.com
          </a>{' '}
          and our team will assist you.
        </li>
      </ul>
      <div className="flex gap-3">
        <Link href="/login" className="btn">
          Back to login
        </Link>
        <Link href="/" className="btn btn-outline">
          Go to homepage
        </Link>
      </div>
    </div>
  );
}
