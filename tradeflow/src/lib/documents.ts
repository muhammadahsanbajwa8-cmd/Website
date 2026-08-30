import 'server-only';

import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { downloadFile } from '@/lib/storage';
import { renderPricedDocument, type PricedLine } from '@/lib/pdf/priced-document';
import type { Business, Customer, Invoice, Quote } from '@/lib/database.types';

/**
 * Turning a stored quote or invoice into a PDF.
 *
 * The document is rendered on demand rather than saved as a file: the record
 * is the source of truth, so a PDF downloaded today always matches what the
 * record says today. The immutable copy — what the customer actually saw — is
 * the `quote_versions` snapshot taken at send time.
 */

/** A share token long enough that guessing one is not a strategy. */
export function newShareToken(): string {
  return randomBytes(24).toString('base64url');
}

async function businessLogo(business: Business) {
  if (!business.logo_path) return null;
  const file = await downloadFile('logos', business.logo_path);
  // pdf-lib embeds PNG and JPEG. An SVG logo is skipped and the business name
  // is typeset instead, which is better than a blank masthead.
  if (!file || /svg/i.test(file.mime)) return null;
  return { bytes: file.bytes, mime: file.mime };
}

export async function renderQuotePdf(
  quote: Quote,
  business: Business,
  customer: Customer | null,
  items: PricedLine[],
  job?: { number: string; name: string; site?: string | null } | null
): Promise<Uint8Array> {
  return renderPricedDocument({
    kind: 'quote',
    business,
    customer,
    number: `${quote.number}${quote.version > 1 ? ` v${quote.version}` : ''}`,
    title: quote.title,
    issueDate: quote.issue_date,
    secondaryDate: quote.expiry_date,
    jobReference: job ? `${job.number} — ${job.name}` : null,
    siteAddress: job?.site ?? null,
    scope: quote.scope_of_work,
    terms: quote.terms,
    paymentTerms: quote.payment_terms,
    items,
    discountCents: quote.discount_cents,
    subtotalCents: quote.subtotal_cents,
    taxCents: quote.tax_cents,
    totalCents: quote.total_cents,
    gstApplies: quote.gst_applies,
    status: quote.status,
    logo: await businessLogo(business),
  });
}

export async function renderInvoicePdf(
  invoice: Invoice,
  business: Business,
  customer: Customer | null,
  items: PricedLine[],
  job?: { number: string; name: string; site?: string | null } | null
): Promise<Uint8Array> {
  return renderPricedDocument({
    kind: 'invoice',
    business,
    customer,
    number: invoice.number,
    title: invoice.title,
    issueDate: invoice.issue_date,
    secondaryDate: invoice.due_date,
    jobReference: job ? `${job.number} — ${job.name}` : null,
    siteAddress: job?.site ?? null,
    terms: null,
    paymentTerms: invoice.payment_terms,
    notes: invoice.notes,
    items,
    discountCents: invoice.discount_cents,
    subtotalCents: invoice.subtotal_cents,
    taxCents: invoice.tax_cents,
    totalCents: invoice.total_cents,
    paidCents: invoice.paid_cents,
    gstApplies: invoice.gst_applies,
    status: invoice.status,
    logo: await businessLogo(business),
  });
}

/**
 * Everything needed to render a quote, in three queries, checked against the
 * business. Returns null when the quote is not this tenant's — the caller
 * turns that into a 404.
 */
export async function loadQuoteForPdf(businessId: string, quoteId: string) {
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!quote) return null;

  const [{ data: business }, { data: customer }, { data: items }, { data: job }] = await Promise.all([
    supabase.from('businesses').select('*').eq('id', businessId).single(),
    supabase.from('customers').select('*').eq('id', quote.customer_id).maybeSingle(),
    supabase
      .from('quote_items')
      .select('*')
      .eq('quote_id', quoteId)
      .eq('business_id', businessId)
      .order('position'),
    quote.job_id
      ? supabase
          .from('jobs')
          .select('id, number, name, site_address_line1, site_suburb, site_state, site_postcode')
          .eq('id', quote.job_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!business) return null;

  return {
    quote: quote as Quote,
    business: business as Business,
    customer: (customer ?? null) as Customer | null,
    items: (items ?? []) as PricedLine[],
    job: job
      ? {
          number: job.number,
          name: job.name,
          site:
            [job.site_address_line1, job.site_suburb, job.site_state, job.site_postcode]
              .filter(Boolean)
              .join(', ') || null,
        }
      : null,
  };
}

export async function loadInvoiceForPdf(businessId: string, invoiceId: string) {
  const supabase = await createClient();

  const { data: invoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!invoice) return null;

  const [{ data: business }, { data: customer }, { data: items }, { data: job }] = await Promise.all([
    supabase.from('businesses').select('*').eq('id', businessId).single(),
    supabase.from('customers').select('*').eq('id', invoice.customer_id).maybeSingle(),
    supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', invoiceId)
      .eq('business_id', businessId)
      .order('position'),
    invoice.job_id
      ? supabase
          .from('jobs')
          .select('id, number, name, site_address_line1, site_suburb, site_state, site_postcode')
          .eq('id', invoice.job_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!business) return null;

  return {
    invoice: invoice as Invoice,
    business: business as Business,
    customer: (customer ?? null) as Customer | null,
    items: (items ?? []) as PricedLine[],
    job: job
      ? {
          number: job.number,
          name: job.name,
          site:
            [job.site_address_line1, job.site_suburb, job.site_state, job.site_postcode]
              .filter(Boolean)
              .join(', ') || null,
        }
      : null,
  };
}

/** A filename a person can find again in their downloads folder. */
export function pdfFilename(kind: string, number: string, businessName: string): string {
  const safeBusiness = businessName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 40);
  return `${number}-${kind}-${safeBusiness}.pdf`;
}
