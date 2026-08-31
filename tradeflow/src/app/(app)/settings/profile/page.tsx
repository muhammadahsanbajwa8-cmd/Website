import Link from 'next/link';
import { requireBusiness } from '@/lib/session';
import { PageHeader, Card, CardBody, CardHeader, DescriptionList } from '@/components/ui';
import { ProfileForm } from './form';
import { roleLabel } from '@/lib/permissions';

export const metadata = { title: 'Your profile' };

export default async function ProfilePage() {
  const session = await requireBusiness();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Your profile"
        breadcrumb={
          <Link href="/settings" className="hover:text-[var(--text-strong)]">
            Settings
          </Link>
        }
      />

      <ProfileForm
        fullName={session.profile?.full_name ?? ''}
        phone={session.profile?.phone ?? ''}
      />

      <Card className="mt-5">
        <CardHeader title="Your access" />
        <CardBody>
          <DescriptionList
            items={[
              { label: 'Email', value: session.email },
              { label: 'Role', value: roleLabel(session.role) },
              { label: 'Business', value: session.business.name },
              {
                label: 'Other businesses',
                value:
                  session.memberships.length > 1
                    ? session.memberships
                        .filter((m) => m.businessId !== session.business.id)
                        .map((m) => m.businessName)
                        .join(', ')
                    : 'None',
              },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}
