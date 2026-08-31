'use client';

import { useActionState } from 'react';
import { inviteMemberAction } from './actions';
import { idleState } from '@/lib/action-state';
import {
  Card,
  CardBody,
  CardHeader,
  Field,
  FormError,
  FormSuccess,
  Input,
  MoneyInput,
  Select,
} from '@/components/ui';
import { CopyButton, SubmitButton } from '@/components/ui/client';
import { roleLabel, type TeamRole } from '@/lib/permissions';

export function InvitePanel({ assignable }: { assignable: TeamRole[] }) {
  const [state, action] = useActionState(inviteMemberAction, idleState);
  const inviteUrl = typeof state.data?.inviteUrl === 'string' ? state.data.inviteUrl : null;

  return (
    <Card className="h-fit">
      <CardHeader
        title="Invite someone"
        description="They set their own password. The invitation only works for this address."
      />
      <CardBody>
        <form action={action} className="space-y-4">
          <FormError>{state.error}</FormError>
          {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

          {inviteUrl ? (
            <div className="space-y-2 rounded-[0.625rem] bg-[var(--surface-sunken)] p-3">
              <div className="break-all font-mono text-xs text-[var(--text-default)]">
                {inviteUrl}
              </div>
              <CopyButton value={inviteUrl} label="Copy invitation link" />
            </div>
          ) : null}

          <Field label="Email" htmlFor="invite-email" error={state.fieldErrors?.email} required>
            <Input
              id="invite-email"
              name="email"
              type="email"
              required
              autoCapitalize="none"
              placeholder="them@yourbusiness.com.au"
            />
          </Field>

          <Field label="Name" htmlFor="invite-name">
            <Input id="invite-name" name="fullName" placeholder="Priya Raman" />
          </Field>

          <Field label="Role" htmlFor="invite-role" required>
            <Select id="invite-role" name="role" defaultValue="worker" required>
              {assignable.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Phone" htmlFor="invite-phone">
            <Input id="invite-phone" name="phone" type="tel" />
          </Field>

          <Field label="Hourly rate" htmlFor="invite-rate" hint="Optional, for your own costing.">
            <MoneyInput id="invite-rate" name="hourlyRate" />
          </Field>

          <SubmitButton className="w-full" pendingLabel="Inviting…">
            Send invitation
          </SubmitButton>
        </form>
      </CardBody>
    </Card>
  );
}
