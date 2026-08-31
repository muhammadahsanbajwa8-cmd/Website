import { NextResponse } from 'next/server';
import { getBusinessSession } from '@/lib/session';
import { loadInvoiceForPdf, pdfFilename, renderInvoicePdf } from '@/lib/documents';

/** The tax invoice PDF, rendered from the live record. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getBusinessSession();
  if (!session || !session.can('invoices.view')) {
    return new NextResponse('Not found', { status: 404 });
  }

  const { id } = await params;
  const loaded = await loadInvoiceForPdf(session.business.id, id);
  if (!loaded) return new NextResponse('Not found', { status: 404 });

  const pdf = await renderInvoicePdf(
    loaded.invoice,
    loaded.business,
    loaded.customer,
    loaded.items,
    loaded.job
  );

  const download = new URL(request.url).searchParams.get('download') === '1';
  const filename = pdfFilename('invoice', loaded.invoice.number, loaded.business.name);

  return new NextResponse(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
