import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { processEndedCall } from '@/lib/voice/after-call';
import { readFormBody, verifyTwilioSignature } from '@/lib/voice/twiml';

/**
 * The call ended.
 *
 * This is where after-call intelligence runs: the transcript becomes a
 * summary, a sentiment, and the specific things the business now has to do.
 * It fires whether the caller hung up, the line dropped, or the agent said
 * goodbye — a dropped call still leaves a record of what was asked for.
 */
export async function POST(request: Request) {
  const params = await readFormBody(request);
  const signature = request.headers.get('x-twilio-signature');

  if (!verifyTwilioSignature(process.env.TWILIO_AUTH_TOKEN ?? null, request.url, params, signature)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const sid = params.CallSid;
  if (!sid) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const { data: call } = await admin
    .from('calls')
    .select('id, business_id, status')
    .eq('provider', 'twilio')
    .eq('provider_call_sid', sid)
    .maybeSingle();

  if (!call) return NextResponse.json({ ok: true });

  const duration = Number(params.CallDuration ?? '0');
  const status = params.CallStatus;

  await admin
    .from('calls')
    .update({
      ended_at: new Date().toISOString(),
      duration_seconds: Number.isFinite(duration) ? duration : null,
      status:
        status === 'no-answer' ? 'no_answer' : status === 'failed' ? 'failed' : 'completed',
    })
    .eq('id', call.id);

  if (call.status === 'in_progress') {
    await processEndedCall(call.business_id, call.id);
  }

  return NextResponse.json({ ok: true });
}
