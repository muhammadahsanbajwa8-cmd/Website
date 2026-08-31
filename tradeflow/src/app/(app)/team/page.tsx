import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { changeRoleAction, removeMemberAction } from './actions';
import {
  Avatar,
  Badge,
  Card,
  CardBody,
  CardHeader,
  Icon,
  PageHeader,
  Select,
  icons,
} from '@/components/ui';
import { ConfirmSubmit, SubmitButton } from '@/components/ui/client';
import { InvitePanel } from './invite';
import { TEAM_ROLES, assignableRoles, capabilitiesFor, roleLabel } from '@/lib/permissions';
import { formatDate, formatMoney, formatPhone } from '@/lib/format';
import type { TeamMember } from '@/lib/database.types';

export const metadata = { title: 'Team' };

export default async function TeamPage() {
  const session = await requireCapability('team.view');
  const supabase = await createClient();

  const { data } = await supabase
    .from('team_members')
    .select('*')
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .order('role')
    .order('full_name', { nullsFirst: false });

  const members = (data ?? []) as TeamMember[];
  const canManage = session.can('team.manage');
  const assignable = assignableRoles(session.role);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Team"
        description="Who can get in, and what each of them can reach."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_19rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="People"
              description={`${members.length} on the team`}
            />
            <ul className="divide-y divide-[var(--line-subtle)]">
              {members.map((member) => {
                const isYou = member.user_id === session.userId;
                const pending = !member.accepted_at;

                return (
                  <li key={member.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
                    <Avatar name={member.full_name ?? member.email} size={38} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-strong)]">
                          {member.full_name ?? member.email}
                        </span>
                        {isYou ? <Badge tone="info">You</Badge> : null}
                        {pending ? <Badge tone="warning">Invitation pending</Badge> : null}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {[member.email, formatPhone(member.phone)].filter(Boolean).join(' · ')}
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {member.hourly_rate_cents
                          ? `${formatMoney(member.hourly_rate_cents)} an hour · `
                          : ''}
                        {member.accepted_at
                          ? `joined ${formatDate(member.accepted_at.slice(0, 10))}`
                          : member.invited_at
                            ? `invited ${formatDate(member.invited_at.slice(0, 10))}`
                            : ''}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {canManage && !isYou && assignable.includes(member.role) ? (
                        <form action={changeRoleAction} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={member.id} />
                          <Select
                            name="role"
                            defaultValue={member.role}
                            className="h-9 w-auto min-w-32 py-0 text-sm"
                            aria-label={`Role for ${member.full_name ?? member.email}`}
                          >
                            {assignable.map((role) => (
                              <option key={role} value={role}>
                                {roleLabel(role)}
                              </option>
                            ))}
                          </Select>
                          <SubmitButton variant="secondary" size="sm" pendingLabel="…">
                            Save
                          </SubmitButton>
                        </form>
                      ) : (
                        <Badge>{roleLabel(member.role)}</Badge>
                      )}

                      {canManage && !isYou ? (
                        <form action={removeMemberAction}>
                          <input type="hidden" name="id" value={member.id} />
                          <ConfirmSubmit
                            confirmTitle={`Remove ${member.full_name ?? member.email}?`}
                            confirmBody="They lose access immediately. Their work stays on the jobs it belongs to."
                            confirmLabel="Remove"
                          >
                            <Icon path={icons.trash} size={14} />
                          </ConfirmSubmit>
                        </form>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="What each role reaches"
              description="Enforced by the database, not just by hiding buttons."
            />
            <CardBody>
              <ul className="space-y-4">
                {TEAM_ROLES.map((role) => (
                  <li key={role.value}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-[var(--text-strong)]">
                        {role.label}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {capabilitiesFor(role.value).length} permissions
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-[var(--text-muted)]">{role.blurb}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-5 border-t border-[var(--line-subtle)] pt-4 text-sm text-[var(--text-muted)]">
                A worker&rsquo;s login is refused quotes, estimates, invoices and payments by row
                level security in Postgres. It is not that the pages are hidden — the query returns
                nothing.
              </p>
            </CardBody>
          </Card>
        </div>

        {canManage ? <InvitePanel assignable={assignable} /> : null}
      </div>
    </div>
  );
}
