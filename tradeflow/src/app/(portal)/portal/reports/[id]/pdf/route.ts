import { NextResponse } from 'next/server';
import { getCustomerSession } from '@/lib/customer-session';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadReportForPdf, renderReportPdf, reportFilename } from '@/lib/report-pdf';

/**
 * The customer's copy of their report, as a PDF.
 *
 * Entitlement is settled first, by a read that row level security has to
 * allow: the report must belong to this customer at this business and must
 * have been sent. Only then is the document assembled with the service role,
 * because the business record and the photo files behind it are not a
 * customer's to read directly.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCustomerSession();
  if (!session) return new NextResponse('Not found', { status: 404 });

  const { id } = await params;
  const supabase = await createClient();

  const { data: allowed } = await supabase
    .from('reports')
    .select('id')
    .eq('id', id)
    .eq('business_id', session.link.businessId)
    .eq('customer_id', session.link.customerId)
    .is('deleted_at', null)
    .not('sent_at', 'is', null)
    .maybeSingle();

  if (!allowed) return new NextResponse('Not found', { status: 404 });

  const loaded = await loadReportForPdf(session.link.businessId, id, createAdminClient());
  if (!loaded) return new NextResponse('Not found', { status: 404 });

  const pdf = await renderReportPdf(loaded);
  const download = new URL(request.url).searchParams.get('download') === '1';
  const filename = reportFilename(loaded.report.number, loaded.templateName, loaded.business.name);

  return new NextResponse(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
