'use client';

import { useActionState } from 'react';
import { inviteCustomerAction, revokeCustomerAccessAction } from '../actions';
import { idleState } from '@/lib/action-state';
import { formatRelative } from '@/lib/format';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  FormSuccess,
  Icon,
  Input,
  icons,
} from '@/components/ui';
import { ConfirmSubmit, CopyButton, SubmitButton } from '@/components/ui/client';

export interface PortalLinkRow {
  id: string;
  email: string;
  invited_at: string | null;
  accepted_at: string | null;
  last_seen_at: string | null;
}

/**
 * Portal access, from the business's side.
 *
 * One card that says whether this customer can sign in, invites them if not,
 * and takes it away again. The link is shown as well as emailed, because the
 * commonest failure is an invitation that goes to spam and the owner needing
 * to text it instead.
 */
export function PortalAccessPanel({
  customerId,
  customerEmail,
  links,
  canEdit,
}: {
  customerId: string;
  customerEmail: string | null;
  links: PortalLinkRow[];
  canEdit: boolean;
}) {
  const [state, action] = useActionState(inviteCustomerAction, idleState);
  const inviteUrl = typeof state.data?.inviteUrl === 'string' ? state.data.inviteUrl : null;

  return (
    <Card>
      <CardHeader
        title="Customer login"
        description="Lets them see their own jobs, reports and invoices — and pay online."
      />

      {links.length > 0 ? (
        <ul className="divide-y divide-[var(--line-subtle)] border-b border-[var(--line-subtle)]">
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--text-strong)]">
                  {link.email}
                </div>
                <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {link.accepted_at
                    ? `Signed in ${link.last_seen_at ? formatRelative(link.last_seen_at) : formatRelative(link.accepted_at)}`
                    : link.invited_at
                      ? `Invited ${formatRelative(link.invited_at)} — not accepted yet`
                      : 'Invited'}
                </div>
              </div>
              <Badge tone={link.accepted_at ? 'success' : 'warning'}>
                {link.accepted_at ? 'Active' : 'Invited'}
              </Badge>
              {canEdit ? (
                <form action={revokeCustomerAccessAction}>
                  <input type="hidden" name="id" value={link.id} />
                  <input type="hidden" name="customerId" value={customerId} />
                  <ConfirmSubmit
                    confirmTitle={`Remove access for ${link.email}?`}
                    confirmBody="They will not be able to sign in. Their jobs, reports and invoices are untouched, and you can invite them again at any time."
                    confirmLabel="Remove access"
                    size="sm"
                  >
                    Remove
                  </ConfirmSubmit>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <CardBody>
          <form action={action} className="space-y-4">
            <input type="hidden" name="customerId" value={customerId} />

            <FormError>{state.error}</FormError>
            {state.ok ? <FormSuccess>{state.message}</FormSuccess> : null}

            {inviteUrl ? (
              <div className="flex flex-wrap items-center gap-2 rounded-[0.625rem] bg-[var(--surface-sunken)] px-3 py-2.5">
                <code className="min-w-0 flex-1 truncate text-xs text-[var(--text-muted)]">
                  {inviteUrl}
                </code>
                <CopyButton value={inviteUrl} label="Copy link" />
              </div>
            ) : null}

            <Field
              label={links.length > 0 ? 'Invite somebody else' : 'Invite them'}
              htmlFor="portalEmail"
              error={state.fieldErrors?.email}
              hint="Usually their own email address. They set their own password."
            >
              <div className="flex flex-wrap gap-2">
                <Input
                  id="portalEmail"
                  name="email"
                  type="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="min-w-0 flex-1"
                  defaultValue={links.length === 0 ? (customerEmail ?? '') : ''}
                  placeholder="them@example.com"
                  aria-invalid={Boolean(state.fieldErrors?.email)}
                />
                <SubmitButton pendingLabel="Sending…">
                  <Icon path={icons.send} size={16} />
                  Send invitation
                </SubmitButton>
              </div>
            </Field>
          </form>
        </CardBody>
      ) : links.length === 0 ? (
        <CardBody>
          <p className="text-sm text-[var(--text-muted)]">
            This customer has no login. An owner or manager can set one up.
          </p>
        </CardBody>
      ) : null}
    </Card>
  );
}
