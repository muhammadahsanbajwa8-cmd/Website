'use server';

import { requireCapability, audit } from '@/lib/session';
import { runAgent } from '@/lib/ai/run';
import { brainSystemPrompt, loadBrain } from '@/lib/ai/brain';
import { aiConfigured, describeAiError, EFFORT } from '@/lib/ai/client';
import { createClient } from '@/lib/supabase/server';
import { fail, ok, type ActionState } from '@/lib/action-state';
import { formatDate, todayInAustralia } from '@/lib/format';

/**
 * The business assistant.
 *
 * Same brain as the phone agent, wider tools: this caller is the owner, so
 * money is on the table. It answers from the tools rather than from memory —
 * if a lookup comes back empty it says so instead of guessing.
 */
export async function askAssistantAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('ai.use');
  const question = String(formData.get('question') ?? '').trim();
  if (!question) return fail('Ask a question.');

  if (!aiConfigured()) {
    return fail(
      'The assistant needs an Anthropic API key. Add ANTHROPIC_API_KEY to .env.local — the rest ' +
        'of the platform works without it.'
    );
  }

  // History arrives as alternating lines so the conversation carries forward
  // without a server-side session.
  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  const raw = formData.get('history');
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as { role: string; content: string }[];
      for (const entry of parsed.slice(-12)) {
        if ((entry.role === 'user' || entry.role === 'assistant') && typeof entry.content === 'string') {
          history.push({ role: entry.role, content: entry.content.slice(0, 8000) });
        }
      }
    } catch {
      // A malformed history is dropped rather than failing the question.
    }
  }

  const supabase = await createClient();
  await supabase.rpc('ensure_ai_brain', { target: session.business.id });

  const brain = await loadBrain(session.business.id);
  const system = brain
    ? brainSystemPrompt(brain, 'assistant')
    : `You are the assistant for ${session.business.name}, an Australian trade business.`;

  try {
    const result = await runAgent({
      systemStable: system,
      systemVolatile: [
        `## Right now`,
        `Today is ${formatDate(todayInAustralia())}.`,
        `You are talking to ${session.profile?.full_name ?? session.email}, whose role is ${session.role}.`,
        session.role === 'accountant'
          ? 'They handle the books. Lead with figures.'
          : 'They run the business.',
      ].join('\n'),
      messages: [...history, { role: 'user', content: question }],
      surface: 'assistant',
      businessId: session.business.id,
      effort: EFFORT.assistant,
      maxTokens: 2000,
      maxToolRounds: 6,
    });

    await audit(session.business.id, {
      action: 'assistant.ask',
      detail: { tools: result.toolCalls.map((call) => call.name) },
    });

    return ok(result.text || 'I could not find an answer to that.', {
      tools: result.toolCalls.map((call) => call.name),
    });
  } catch (error) {
    return fail(describeAiError(error));
  }
}
