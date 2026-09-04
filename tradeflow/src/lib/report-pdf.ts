import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { downloadFile } from '@/lib/storage';
import { parseSections, type ReportSection } from '@/lib/reports';
import { renderReport, type ReportPdfPhoto } from '@/lib/pdf/report';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Business, Database, Json, Report } from '@/lib/database.types';

/**
 * Assembling a report PDF: the report, its template, the job and customer it
 * belongs to, and the photos attached to it, downloaded so they can be
 * embedded.
 */

export interface LoadedReport {
  report: Report;
  business: Business;
  templateName: string;
  sections: ReportSection[];
  jobLabel: string | null;
  customerLabel: string | null;
  siteAddress: string | null;
  preparedBy: string | null;
  photos: { storage_path: string; caption: string | null; category: string; taken_at: string }[];
}

/**
 * @param client an already-scoped Supabase client. The customer portal passes
 * the service-role one, because a customer is entitled to their own report but
 * not to the `businesses` row or the photo files behind it — their entitlement
 * is established by the caller before this is reached, with a read that row
 * level security had to allow.
 */
export async function loadReportForPdf(
  businessId: string,
  reportId: string,
  client?: SupabaseClient<Database>
): Promise<LoadedReport | null> {
  const supabase = client ?? (await createClient());

  const { data: report } = await supabase
    .from('reports')
    .select('*')
    .eq('id', reportId)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!report) return null;

  const [{ data: business }, { data: template }, { data: job }, { data: customer }] =
    await Promise.all([
      supabase.from('businesses').select('*').eq('id', businessId).single(),
      supabase
        .from('report_templates')
        .select('name, sections')
        .eq('key', report.template_key)
        .or(`business_id.is.null,business_id.eq.${businessId}`)
        .limit(1)
        .maybeSingle(),
      report.job_id
        ? supabase
            .from('jobs')
            .select('number, name, site_address_line1, site_suburb, site_state, site_postcode')
            .eq('id', report.job_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      report.customer_id
        ? supabase
            .from('customers')
            .select('name, company')
            .eq('id', report.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  if (!business) return null;

  const { data: photos } = await supabase
    .from('job_photos')
    .select('storage_path, caption, category, taken_at')
    .eq('business_id', businessId)
    .eq('report_id', reportId)
    .is('deleted_at', null)
    .order('taken_at')
    // A report PDF with two hundred photographs in it is not a report; the
    // page cap keeps a site report mailable.
    .limit(24);

  const { data: author } = report.created_by
    ? await supabase.from('profiles').select('full_name').eq('id', report.created_by).maybeSingle()
    : { data: null };

  return {
    report: report as Report,
    business: business as Business,
    templateName: template?.name ?? 'Report',
    sections: parseSections((template?.sections ?? []) as Json),
    jobLabel: job ? `${job.number} — ${job.name}` : null,
    customerLabel: customer ? customer.company || customer.name : null,
    siteAddress: job
      ? [job.site_address_line1, job.site_suburb, job.site_state, job.site_postcode]
          .filter(Boolean)
          .join(', ') || null
      : null,
    preparedBy: author?.full_name ?? null,
    photos: photos ?? [],
  };
}

export async function renderReportPdf(loaded: LoadedReport): Promise<Uint8Array> {
  // Photo bytes are fetched in parallel; one that fails to download is dropped
  // rather than failing the whole document.
  const fetched = await Promise.all(
    loaded.photos.map(async (photo): Promise<ReportPdfPhoto | null> => {
      const file = await downloadFile('photos', photo.storage_path);
      // pdf-lib embeds JPEG and PNG only; a HEIC from an iPhone is skipped
      // rather than failing the document.
      if (!file || !/jpeg|jpg|png/i.test(file.mime)) return null;
      return {
        bytes: file.bytes,
        mime: file.mime,
        caption: photo.caption,
        category: photo.category,
        takenAt: photo.taken_at,
      };
    })
  );
  const photos = fetched.filter((photo): photo is ReportPdfPhoto => photo !== null);

  const logo = loaded.business.logo_path
    ? await downloadFile('logos', loaded.business.logo_path)
    : null;

  return renderReport({
    business: {
      name: loaded.business.name,
      abn: loaded.business.abn,
      phone: loaded.business.phone,
      email: loaded.business.email,
    },
    logo: logo && !/svg/i.test(logo.mime) ? { bytes: logo.bytes, mime: logo.mime } : null,
    templateName: loaded.templateName,
    sections: loaded.sections,
    number: loaded.report.number,
    title: loaded.report.title,
    reportDate: loaded.report.report_date,
    status: loaded.report.status,
    jobLabel: loaded.jobLabel,
    customerLabel: loaded.customerLabel,
    siteAddress: loaded.siteAddress,
    summary: loaded.report.summary,
    data: loaded.report.data as Record<string, unknown>,
    photos,
    signatureName: loaded.report.signature_name,
    signedAt: loaded.report.signed_at,
    preparedBy: loaded.preparedBy,
  });
}

export function reportFilename(number: string, templateName: string, businessName: string): string {
  const slug = (value: string) =>
    value.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40);
  return `${number}-${slug(templateName)}-${slug(businessName)}.pdf`;
}
