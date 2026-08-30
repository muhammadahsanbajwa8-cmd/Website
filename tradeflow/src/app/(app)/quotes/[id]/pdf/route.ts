import { NextResponse } from 'next/server';
import { getBusinessSession } from '@/lib/session';
import { loadQuoteForPdf, pdfFilename, renderQuotePdf } from '@/lib/documents';

/**
 * The quote PDF.
 *
 * `?download=1` sets an attachment disposition; without it the browser's own
 * viewer opens inline, which is what the preview and the print button want.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getBusinessSession();
  if (!session || !session.can('quotes.view')) {
    return new NextResponse('Not found', { status: 404 });
  }

  const { id } = await params;
  const loaded = await loadQuoteForPdf(session.business.id, id);
  if (!loaded) return new NextResponse('Not found', { status: 404 });

  const pdf = await renderQuotePdf(
    loaded.quote,
    loaded.business,
    loaded.customer,
    loaded.items,
    loaded.job
  );

  const download = new URL(request.url).searchParams.get('download') === '1';
  const filename = pdfFilename('quote', loaded.quote.number, loaded.business.name);

  return new NextResponse(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      // Rendered from live data every time; a cached copy would go stale the
      // moment a line item changed.
      'Cache-Control': 'private, no-store',
    },
  });
}
