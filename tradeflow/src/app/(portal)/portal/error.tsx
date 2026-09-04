'use client';

import Link from 'next/link';
import { Button, Card, CardBody, Icon, icons } from '@/components/ui';

/**
 * When something goes wrong on a customer's page.
 *
 * No stack trace, no error code — a sentence about what happened, a button
 * that tries again, and the way back. The detail is on the server logs where
 * it belongs.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardBody className="space-y-4 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bad-soft)] text-[var(--bad)]">
            <Icon path={icons.warning} size={24} />
          </span>

          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-strong)]">
            That did not load
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Something went wrong at our end — nothing you did. Try again, and if it keeps happening,
            send a message and we will sort it out.
          </p>

          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Button onClick={reset}>Try again</Button>
            <Link
              href="/portal"
              className="inline-flex h-11 items-center rounded-[0.625rem] border border-[var(--line-default)] px-4 text-sm font-medium text-[var(--text-strong)] hover:bg-[var(--surface-sunken)]"
            >
              Back to home
            </Link>
          </div>

          {error.digest ? (
            <p className="pt-2 text-xs text-[var(--text-muted)]">
              If you get in touch, quote reference {error.digest}.
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
