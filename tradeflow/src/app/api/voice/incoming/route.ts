import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { startCall } from '@/lib/voice/agent';
import {
  TWIML_HEADERS,
  gather,
  readFormBody,
  sayAndHangUp,
  verifyTwilioSignature,
} from '@/lib/voice/twiml';
import { env } from '@/lib/env';

/**
 * A phone call arrives.
 *
 * The business is established by the number that was dialled — never by
 * anything the caller can set — and every tool the agent can reach for the
 * rest of the call is bound to that business id.
 *
 * The greeting is composed rather than generated, so the caller hears a voice
 * immediately instead of waiting on a model round trip, and so the AI
 * disclosure cannot be prompted away.
 */
export async function POST(request: Request) {
  const url = request.url;
  const params = await readFormBody(request);
  const signature = request.headers.get('x-twilio-signature');

  // A public URL that starts an AI conversation against a business's records
  // is refused unless it is provably from the carrier.
  if (!verifyTwilioSignature(process.env.TWILIO_AUTH_TOKEN ?? null, url, params, signature)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const toNumber = params.To ?? '';
  const fromNumber = params.From ?? null;

  const admin = createAdminClient();
  const { data: brainRow } = await admin
    .from('ai_brain')
    .select('business_id, enabled, voice_name, language, voicemail_greeting, max_call_minutes')
    .eq('phone_number', toNumber)
    .maybeSingle();

  if (!brainRow) {
    return new NextResponse(
      sayAndHangUp('Sorry, this number is not in service. Please check the number and try again.'),
      { headers: TWIML_HEADERS }
    );
  }

  if (!brainRow.enabled) {
    return new NextResponse(
      sayAndHangUp(
        brainRow.voicemail_greeting ??
          'Thanks for calling. Nobody is available to take your call — please try again later.',
        { voice: brainRow.voice_name, language: brainRow.language }
      ),
      { headers: TWIML_HEADERS }
    );
  }

  const started = await startCall({
    businessId: brainRow.business_id,
    fromNumber,
    toNumber,
    provider: 'twilio',
    providerCallSid: params.CallSid ?? null,
  });

  if (!started) {
    return new NextResponse(
      sayAndHangUp('Sorry, we are unable to take calls right now. Please try again shortly.'),
      { headers: TWIML_HEADERS }
    );
  }

  return new NextResponse(
    gather({
      say: started.greeting,
      action: `${env.appUrl}/api/voice/turn?call=${started.callId}`,
      voice: brainRow.voice_name,
      language: brainRow.language,
      // Barge-in on: the caller can talk over the greeting, which is what
      // people actually do.
      bargeIn: true,
    }),
    { headers: TWIML_HEADERS }
  );
}
