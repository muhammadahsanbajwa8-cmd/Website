import { requireCustomer } from '@/lib/customer-session';
import { signOutAction } from '@/app/(auth)/actions';
import { formatAbn, formatPhone } from '@/lib/format';
import { Card, CardBody, CardHeader, DescriptionList, PageHeader } from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { AccountForm } from './form';

export const metadata = { title: 'Account' };

export default async function AccountPage() {
  const session = await requireCustomer();
  const { link } = session;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Your account"
        description="Keep this right and everything reaches you — reports, invoices and receipts all use it."
      />

      <div className="space-y-5">
        <AccountForm
          businessName={link.businessName}
          defaults={{
            fullName: session.profile?.full_name ?? link.customerName,
            email: link.customerEmail ?? session.email,
            phone: link.customerPhone ?? '',
            addressLine1: link.customerAddressLine1 ?? '',
            addressLine2: link.customerAddressLine2 ?? '',
            suburb: link.customerSuburb ?? '',
            state: link.customerState ?? '',
            postcode: link.customerPostcode ?? '',
          }}
        />

        <Card>
          <CardHeader title="Signing in" description="How you get to this account." />
          <CardBody className="space-y-4">
            <DescriptionList
              items={[
                { label: 'Sign-in email', value: session.email },
                {
                  label: 'You are a customer of',
                  value: session.links.map((l) => l.businessName).join(', '),
                },
              ]}
            />
            <p className="text-sm text-[var(--text-muted)]">
              To change the address you sign in with, or your password, ask {link.businessName} to
              send a new invitation to the address you would rather use.
            </p>
            <form action={signOutAction}>
              <SubmitButton variant="secondary" pendingLabel="Signing out…">
                Sign out
              </SubmitButton>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={link.businessName} description="Who you are dealing with." />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Business', value: link.businessName },
                { label: 'ABN', value: link.businessAbn ? formatAbn(link.businessAbn) : '—' },
                {
                  label: 'Phone',
                  value: link.businessPhone ? (
                    <a
                      href={`tel:${link.businessPhone.replace(/\s+/g, '')}`}
                      className="text-[var(--accent)] hover:underline"
                    >
                      {formatPhone(link.businessPhone)}
                    </a>
                  ) : (
                    '—'
                  ),
                },
                {
                  label: 'Email',
                  value: link.businessEmail ? (
                    <a
                      href={`mailto:${link.businessEmail}`}
                      className="text-[var(--accent)] hover:underline"
                    >
                      {link.businessEmail}
                    </a>
                  ) : (
                    '—'
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
