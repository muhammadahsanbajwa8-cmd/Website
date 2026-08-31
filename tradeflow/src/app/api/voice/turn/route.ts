import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { handleTurn } from '@/lib/voice/agent';
import { processEndedCall } from '@/lib/voice/after-call';
import {
  TWIML_HEADERS,
  gather,
  readFormBody,
  sayAndHangUp,
  dial,
  verifyTwilioSignature,
} from '@/lib/voice/twiml';
import { env } from '@/lib/env';

/**
 * One turn of the conversation: what the caller said comes in as
 * `SpeechResult`, one short reply goes back out.
 *
 * Twilio reports a confidence score with the transcript. A low score is passed
 * to the agent rather than acted on here, so it asks about the single detail
 * it is unsure of instead of making the caller start again.
 */
export async function POST(request: Request) {
  const url = request.url;
  const params = await readFormBody(request);
  const signature = request.headers.get('x-twilio-signature');

  if (!verifyTwilioSignature(process.env.TWILIO_AUTH_TOKEN ?? null, url, params, signature)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const callId = new URL(url).searchParams.get('call');
  if (!callId) {
    return new NextResponse(sayAndHangUp('Sorry, something went wrong. Please call back.'), {
      headers: TWIML_HEADERS,
    });
  }

  const admin = createAdminClient();
  const { data: call } = await admin
    .from('calls')
    .select('id, business_id, started_at, status')
    .eq('id', callId)
    .maybeSingle();

  if (!call || call.status !== 'in_progress') {
    return new NextResponse(sayAndHangUp('Thanks for calling. Goodbye.'), {
      headers: TWIML_HEADERS,
    });
  }

  const { data: brain } = await admin
    .from('ai_brain')
    .select('voice_name, language, max_call_minutes, escalation_phone')
    .eq('business_id', call.business_id)
    .maybeSingle();

  const voice = { voice: brain?.voice_name, language: brain?.language };

  // A call that has run past its ceiling is wound up rather than left running.
  const minutes = (Date.now() - Date.parse(call.started_at)) / 60_000;
  if (minutes > (brain?.max_call_minutes ?? 10)) {
    await processEndedCall(call.business_id, callId);
    return new NextResponse(
      sayAndHangUp(
        'I have got what I need and someone will be in touch. Thanks for calling.',
        voice
      ),
      { headers: TWIML_HEADERS }
    );
  }

  const said = (params.SpeechResult ?? '').trim();
  const confidence = params.Confidence ? Number(params.Confidence) : null;

  // Silence. Prompt once, then take the hint.
  if (!said) {
    const { count } = await admin
      .from('call_turns')
      .select('id', { count: 'exact', head: true })
      .eq('call_id', callId)
      .eq('role', 'agent');

    if ((count ?? 0) >= 3) {
      await processEndedCall(call.business_id, callId);
      return new NextResponse(
        sayAndHangUp('I could not hear anyone there, so I will let you go. Call back any time.', voice),
        { headers: TWIML_HEADERS }
      );
    }

    return new NextResponse(
      gather({
        say: 'Sorry, I did not catch that. What can I help you with?',
        action: `${env.appUrl}/api/voice/turn?call=${callId}`,
        ...voice,
      }),
      { headers: TWIML_HEADERS }
    );
  }

  const result = await handleTurn({
    callId,
    businessId: call.business_id,
    said,
    confidence: Number.isFinite(confidence) ? confidence : null,
    // Twilio sets this when the caller cut the prompt off.
    interrupted: params.SpeechResultBargeIn === 'true' || params.BargeIn === 'true',
  });

  // Escalated with a number to transfer to: put a person on.
  if (result.escalated && brain?.escalation_phone) {
    await processEndedCall(call.business_id, callId);
    return new NextResponse(
      dial(brain.escalation_phone, { say: result.reply, ...voice }),
      { headers: TWIML_HEADERS }
    );
  }

  if (result.shouldEndCall) {
    await processEndedCall(call.business_id, callId);
    return new NextResponse(sayAndHangUp(result.reply, voice), { headers: TWIML_HEADERS });
  }

  return new NextResponse(
    gather({
      say: result.reply,
      action: `${env.appUrl}/api/voice/turn?call=${callId}`,
      ...voice,
      bargeIn: true,
    }),
    { headers: TWIML_HEADERS }
  );
}
