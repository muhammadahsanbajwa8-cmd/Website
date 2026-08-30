'use client';

import { useActionState, useState } from 'react';
import { deleteContactAction, saveContactAction } from '../actions';
import { idleState } from '@/lib/action-state';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  FormError,
  Icon,
  Input,
  buttonClass,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { formatPhone } from '@/lib/format';
import type { Contact } from '@/lib/database.types';

/** Extra people at a customer: a site foreman, the accounts payable clerk. */
export function ContactsPanel({
  customerId,
  contacts,
  canEdit,
}: {
  customerId: string;
  contacts: Contact[];
  canEdit: boolean;
}) {
  const [state, action] = useActionState(saveContactAction, idleState);
  const [adding, setAdding] = useState(false);

  return (
    <Card>
      <CardHeader
        title="Contacts"
        description="The other people you deal with here."
        action={
          canEdit ? (
            <button
              type="button"
              onClick={() => setAdding((value) => !value)}
              className={buttonClass('secondary', 'sm')}
            >
              <Icon path={adding ? icons.x : icons.plus} size={15} />
              {adding ? 'Cancel' : 'Add'}
            </button>
          ) : null
        }
      />

      {contacts.length === 0 && !adding ? (
        <CardBody>
          <p className="text-sm text-[var(--text-muted)]">
            No extra contacts. The customer&rsquo;s own email and phone are on the details
            above.
          </p>
        </CardBody>
      ) : null}

      {contacts.length > 0 ? (
        <ul className="divide-y divide-[var(--line-subtle)]">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-[var(--text-strong)]">
                    {contact.name}
                  </span>
                  {contact.is_primary ? <Badge tone="info">Primary</Badge> : null}
                </div>
                {contact.role ? (
                  <div className="text-xs text-[var(--text-muted)]">{contact.role}</div>
                ) : null}
                <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {[contact.email, formatPhone(contact.phone)].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              {canEdit ? (
                <form action={deleteContactAction}>
                  <input type="hidden" name="id" value={contact.id} />
                  <input type="hidden" name="customerId" value={customerId} />
                  <button
                    type="submit"
                    aria-label={`Remove ${contact.name}`}
                    className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--bad)]"
                  >
                    <Icon path={icons.trash} size={15} />
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {adding ? (
        <CardBody className="border-t border-[var(--line-subtle)]">
          <form action={action} className="space-y-3">
            <input type="hidden" name="customerId" value={customerId} />
            <FormError>{state.error}</FormError>

            <Field label="Name" htmlFor="contact-name" error={state.fieldErrors?.name} required>
              <Input id="contact-name" name="name" required placeholder="Priya Raman" />
            </Field>

            <Field label="Role" htmlFor="contact-role">
              <Input id="contact-role" name="role" placeholder="Site foreman" />
            </Field>

            <Field label="Email" htmlFor="contact-email" error={state.fieldErrors?.email}>
              <Input id="contact-email" name="email" type="email" autoCapitalize="none" />
            </Field>

            <Field label="Phone" htmlFor="contact-phone">
              <Input id="contact-phone" name="phone" type="tel" />
            </Field>

            <Checkbox name="isPrimary" label="Main point of contact" />

            <SubmitButton size="sm" pendingLabel="Adding…">
              Add contact
            </SubmitButton>
          </form>
        </CardBody>
      ) : null}
    </Card>
  );
}
