import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { pdfFilename, renderQuotePdf } from '@/lib/documents';
import type { Business, Customer, Quote } from '@/lib/database.types';
import type { PricedLine } from '@/lib/pdf/priced-document';

/**
 * The customer's copy of the quote PDF.
 *
 * The token is the authorisation. It is resolved to a quote id with the
 * service role and nothing else about the request is trusted: the URL carries
 * no quote id, no business id, and no way to ask for a different document.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || token.length < 20) return new NextResponse('Not found', { status: 404 });

  const admin = createAdminClient();

  const { data: quote } = await admin
    .from('quotes')
    .select('*')
    .eq('share_token', token)
    .is('deleted_at', null)
    .maybeSingle();

  if (!quote) return new NextResponse('Not found', { status: 404 });

  const [{ data: business }, { data: customer }, { data: items }, { data: job }] = await Promise.all([
    admin.from('businesses').select('*').eq('id', quote.business_id).single(),
    admin.from('customers').select('*').eq('id', quote.customer_id).maybeSingle(),
    admin.from('quote_items').select('*').eq('quote_id', quote.id).order('position'),
    quote.job_id
      ? admin
          .from('jobs')
          .select('number, name, site_address_line1, site_suburb, site_state, site_postcode')
          .eq('id', quote.job_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!business) return new NextResponse('Not found', { status: 404 });

  const pdf = await renderQuotePdf(
    quote as Quote,
    business as Business,
    (customer ?? null) as Customer | null,
    (items ?? []) as PricedLine[],
    job
      ? {
          number: job.number,
          name: job.name,
          site:
            [job.site_address_line1, job.site_suburb, job.site_state, job.site_postcode]
              .filter(Boolean)
              .join(', ') || null,
        }
      : null
  );

  const download = new URL(request.url).searchParams.get('download') === '1';
  const filename = pdfFilename('quote', quote.number, business.name);

  return new NextResponse(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
