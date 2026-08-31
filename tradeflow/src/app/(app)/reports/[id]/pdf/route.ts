import { NextResponse } from 'next/server';
import { getBusinessSession } from '@/lib/session';
import { loadReportForPdf, renderReportPdf, reportFilename } from '@/lib/report-pdf';

/** The report PDF, photos and all. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getBusinessSession();
  if (!session || !session.can('reports.view')) {
    return new NextResponse('Not found', { status: 404 });
  }

  const { id } = await params;
  const loaded = await loadReportForPdf(session.business.id, id);
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
