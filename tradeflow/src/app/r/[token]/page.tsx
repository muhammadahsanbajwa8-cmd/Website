import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { signedUrls } from '@/lib/storage';
import { Logo } from '@/components/marketing';
import { Badge } from '@/components/ui';
import { formatAbn, formatDate, formatDateLong } from '@/lib/format';
import { parseSections } from '@/lib/reports';
import type { Json } from '@/lib/database.types';

/**
 * The customer's report.
 *
 * Unauthenticated: the share token in the URL is the credential. Everything
 * here comes from `public_report_by_token()`, a definer function that returns
 * exactly the fields a customer may see and refuses a report that has not been
 * sent. No internal ids, no other reports, no pricing.
 */

export const dynamic = 'force-dynamic';

interface ReportPayload {
  report: {
    id: string;
    number: string;
    title: string;
    report_date: string;
    status: string;
    summary: string | null;
    data: Record<string, unknown>;
    signature_name: string | null;
    sent_at: string | null;
    viewed_at: string | null;
  };
  business: {
    name: string;
    abn: string | null;
    email: string | null;
    phone: string | null;
    address_line1: string | null;
    suburb: string | null;
    state: string | null;
    postcode: string | null;
    logo_path: string | null;
  };
  customer: { name: string | null; company: string | null };
  job: { number: string; name: string; site_address_line1: string | null; site_suburb: string | null } | null;
  photos: { caption: string | null; storage_path: string; taken_at: string | null }[];
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data } = await admin.rpc('public_report_by_token', { p_token: token });
  const payload = data as unknown as ReportPayload | null;
  return {
    title: payload ? `${payload.report.title} — ${payload.business.name}` : 'Report',
    robots: { index: false, follow: false },
  };
}

export default async function CustomerReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data } = await admin.rpc('public_report_by_token', { p_token: token });
  const payload = data as unknown as ReportPayload | null;
  if (!payload) notFound();

  const { report, business, customer, job, photos } = payload;

  // Photo files are private; sign them for this render only.
  const imageUrls = photos.length
    ? await signedUrls('photos', photos.map((photo) => photo.storage_path), 3600)
    : new Map<string, string>();

  // Whatever the template asked, with whatever was filled in.
  const { data: template } = await admin
    .from('report_templates')
    .select('sections')
    .eq('is_system', true)
    .limit(1)
    .maybeSingle();

  const sections = parseSections((template?.sections ?? []) as Json);
  const answers = report.data ?? {};
  const answered = sections
    .flatMap((section) =>
      section.fields.map((field) => ({
        section: section.title,
        label: field.label,
        value: answers[field.id],
      }))
    )
    .filter((entry) => entry.value !== undefined && entry.value !== null && String(entry.value).trim() !== '');

  const address = [business.address_line1, business.suburb, business.state, business.postcode]
    .filter(Boolean)
    .join(' ');

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-8 sm:py-12">
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--line-subtle)] bg-[var(--surface-card)] shadow-[var(--shadow-card)]">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line-subtle)] px-6 py-5 sm:px-8">
          <div>
            <p className="text-base font-semibold text-[var(--text-strong)]">{business.name}</p>
            {business.abn ? (
              <p className="text-xs text-[var(--text-muted)]">ABN {formatAbn(business.abn)}</p>
            ) : null}
          </div>
          <Badge tone={report.status === 'sent' || report.status === 'final' ? 'success' : 'neutral'}>
            {report.number}
          </Badge>
        </header>

        <div className="px-6 py-6 sm:px-8">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-strong)]">
            {report.title}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {job ? `${job.name} · ` : ''}
            {formatDateLong(report.report_date)}
            {customer.company || customer.name ? ` · for ${customer.company || customer.name}` : ''}
          </p>

          {job?.site_address_line1 || job?.site_suburb ? (
            <p className="mt-0.5 text-sm text-[var(--text-muted)]">
              {[job.site_address_line1, job.site_suburb].filter(Boolean).join(', ')}
            </p>
          ) : null}

          {report.summary ? (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-[var(--text-strong)]">Summary</h2>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-default)]">
                {report.summary}
              </p>
            </section>
          ) : null}

          {answered.length > 0 ? (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-[var(--text-strong)]">Details</h2>
              <dl className="mt-2 divide-y divide-[var(--line-subtle)] border-t border-[var(--line-subtle)]">
                {answered.map((entry, index) => (
                  <div key={index} className="grid gap-1 py-2.5 sm:grid-cols-[12rem_1fr] sm:gap-4">
                    <dt className="text-sm text-[var(--text-muted)]">{entry.label}</dt>
                    <dd className="whitespace-pre-wrap text-sm text-[var(--text-default)]">
                      {typeof entry.value === 'boolean'
                        ? entry.value
                          ? 'Yes'
                          : 'No'
                        : String(entry.value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {photos.length > 0 ? (
            <section className="mt-6">
              <h2 className="text-sm font-semibold text-[var(--text-strong)]">Photos</h2>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((photo, index) => {
                  const url = imageUrls.get(photo.storage_path);
                  if (!url) return null;
                  return (
                    <figure key={index} className="overflow-hidden rounded-[0.625rem] border border-[var(--line-subtle)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={photo.caption ?? 'Site photo'} className="aspect-4/3 w-full object-cover" />
                      {photo.caption ? (
                        <figcaption className="px-2 py-1.5 text-xs text-[var(--text-muted)]">
                          {photo.caption}
                        </figcaption>
                      ) : null}
                    </figure>
                  );
                })}
              </div>
            </section>
          ) : null}

          {report.signature_name ? (
            <section className="mt-6 border-t border-[var(--line-subtle)] pt-4">
              <p className="text-sm text-[var(--text-muted)]">
                Signed by <span className="font-medium text-[var(--text-strong)]">{report.signature_name}</span>
                {report.sent_at ? ` · ${formatDate(report.sent_at)}` : ''}
              </p>
            </section>
          ) : null}
        </div>

        <footer className="border-t border-[var(--line-subtle)] bg-[var(--surface-sunken)] px-6 py-4 text-xs text-[var(--text-muted)] sm:px-8">
          <p className="font-medium text-[var(--text-default)]">{business.name}</p>
          <p className="mt-0.5">
            {[address, business.phone, business.email].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-2">
            Something not right? Reply to the email this came with and it reaches us directly.
          </p>
        </footer>
      </div>

      <p className="mt-4 flex items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
        Sent with <Logo size="sm" />
      </p>
    </main>
  );
}
