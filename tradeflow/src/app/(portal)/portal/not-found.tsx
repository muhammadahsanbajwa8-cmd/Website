import Link from 'next/link';
import { Card, CardBody, Icon, icons } from '@/components/ui';

/** A page, or a document, that is not this customer's to open. */
export default function PortalNotFound() {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Card>
        <CardBody className="space-y-4 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-muted)]">
            <Icon path={icons.search} size={24} />
          </span>

          <h1 className="text-xl font-semibold tracking-tight text-[var(--text-strong)]">
            We could not find that
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            The page may have moved, or it belongs to a different account. Everything of yours is
            reachable from the tabs above.
          </p>

          <div className="flex flex-wrap justify-center gap-2 pt-1">
            <Link
              href="/portal"
              className="inline-flex h-11 items-center rounded-[0.625rem] bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-on)]"
            >
              Back to home
            </Link>
            <Link
              href="/portal/messages"
              className="inline-flex h-11 items-center rounded-[0.625rem] border border-[var(--line-default)] px-4 text-sm font-medium text-[var(--text-strong)] hover:bg-[var(--surface-sunken)]"
            >
              Ask us about it
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
