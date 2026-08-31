import Link from 'next/link';
import { requireBusiness } from '@/lib/session';
import { featureStatus } from '@/lib/env';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Icon,
  PageHeader,
  icons,
} from '@/components/ui';
import { BusinessSettingsForm } from './form';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const session = await requireBusiness();
  const features = featureStatus();

  const links = [
    { href: '/settings/profile', label: 'Your profile', icon: icons.customers, blurb: 'Your name and phone number.' },
    { href: '/settings/ai', label: 'AI assistant', icon: icons.ai, blurb: 'What your assistant knows and how it answers the phone.' },
    { href: '/team', label: 'Team', icon: icons.team, blurb: 'Who can get in, and what they can reach.' },
    { href: '/settings/demo', label: 'Demo data', icon: icons.building, blurb: 'Load a worked example, or clear it out.' },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Settings"
        description="What goes on your quotes and invoices, and how the platform is set up."
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex gap-3 rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-raised)]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.625rem] bg-[var(--accent-soft)] text-[var(--accent)]">
              <Icon path={link.icon} size={18} />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-[var(--text-strong)]">{link.label}</span>
              <span className="mt-0.5 block text-sm text-[var(--text-muted)]">{link.blurb}</span>
            </span>
          </Link>
        ))}
      </div>

      {session.can('business.edit') ? (
        <BusinessSettingsForm business={session.business} />
      ) : (
        <Card>
          <CardBody>
            <p className="text-sm text-[var(--text-muted)]">
              Only an owner or admin can change the business details.
            </p>
          </CardBody>
        </Card>
      )}

      <Card className="mt-5">
        <CardHeader
          title="Integrations"
          description="What is switched on, and what each one is waiting for."
        />
        <ul className="divide-y divide-[var(--line-subtle)]">
          {features.map((feature) => (
            <li key={feature.key} className="flex items-start gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text-strong)]">
                    {feature.name}
                  </span>
                  <Badge tone={feature.ready ? 'success' : 'neutral'}>
                    {feature.ready ? 'Ready' : 'Not configured'}
                  </Badge>
                </div>
                <p className="mt-0.5 text-sm text-[var(--text-muted)]">{feature.note}</p>
                {feature.missing.length > 0 ? (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Needs:{' '}
                    {feature.missing.map((key) => (
                      <code key={key} className="mr-1.5">
                        {key}
                      </code>
                    ))}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <CardBody className="border-t border-[var(--line-subtle)]">
          <p className="text-sm text-[var(--text-muted)]">
            Everything above is optional. The platform runs on Supabase alone — each of these adds
            a capability and says plainly what it needs, rather than failing quietly.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
