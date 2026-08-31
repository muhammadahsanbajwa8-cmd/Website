import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { EFFORT, anthropic, model, textOf, type Effort } from './client';
import { runTool, toolsFor, type ToolContext, type ToolSurface } from './tools';

/**
 * The agent loop.
 *
 * A hand-written loop rather than the SDK's tool runner, for one reason: on a
 * phone call the loop needs a hard ceiling on round trips, because every extra
 * lookup is another second of silence in a caller's ear. Owning the loop means
 * owning that budget.
 *
 * Tool results all go back in a single user message, as the API expects —
 * splitting them across messages teaches the model to stop calling tools in
 * parallel, and parallel lookups are exactly what keeps a phone turn short.
 */

export interface RunOptions {
  /** Cached prefix: the business brain. Identical bytes for a given business. */
  systemStable: string;
  /** Uncached suffix: who is calling, the time, what is already known. */
  systemVolatile?: string;
  messages: Anthropic.MessageParam[];
  surface: ToolSurface;
  businessId: string;
  customerId?: string | null;
  effort?: Effort;
  maxTokens?: number;
  /** Round trips allowed before the model must answer with what it has. */
  maxToolRounds?: number;
}

export interface RunResult {
  text: string;
  /** The full exchange, ready to be sent back as history on the next turn. */
  messages: Anthropic.MessageParam[];
  toolCalls: { name: string; input: unknown }[];
  escalation: { reason: string; urgency: string } | null;
  proposals: ToolContext['proposals'];
  usage: { input: number; output: number; cacheRead: number };
  stoppedEarly: boolean;
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
  const client = anthropic();
  const surface = options.surface;
  const maxRounds = options.maxToolRounds ?? (surface === 'phone' ? 3 : 6);

  const context: ToolContext = {
    businessId: options.businessId,
    surface,
    customerId: options.customerId ?? null,
    escalation: null,
    proposals: [],
  };

  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: options.systemStable,
      // The brain is stable per business, so it is worth caching: on the
      // second turn of a call it reads back at a tenth of the cost, and the
      // volatile block below never enters the cached prefix.
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (options.systemVolatile) {
    system.push({ type: 'text', text: options.systemVolatile });
  }

  const tools = toolsFor(surface);
  const messages: Anthropic.MessageParam[] = [...options.messages];
  const toolCalls: { name: string; input: unknown }[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  let stoppedEarly = false;
  let text = '';

  for (let round = 0; round <= maxRounds; round += 1) {
    const lastRound = round === maxRounds;

    const response = await client.messages.create({
      model: model(),
      max_tokens: options.maxTokens ?? (surface === 'phone' ? 400 : 4000),
      system,
      messages,
      // On the final round the tools are withheld, which forces an answer from
      // what has already been gathered rather than another lookup nobody hears
      // the result of.
      ...(lastRound ? {} : { tools }),
      output_config: { effort: options.effort ?? (surface === 'phone' ? EFFORT.voice : EFFORT.assistant) },
    });

    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;

    // A safety decline is not an error to the caller: the agent simply hands
    // the call to a person.
    if (response.stop_reason === 'refusal') {
      context.escalation ??= {
        reason: 'The assistant declined to answer and handed the call over.',
        urgency: 'routine',
      };
      text = 'I might not be the right one to help with that — let me get it to the right person.';
      break;
    }

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      text = textOf(response);
      break;
    }

    if (lastRound) {
      // Should not be reachable — tools were withheld above — but if the model
      // still asks for one, answer with what is in hand rather than loop.
      text = textOf(response);
      stoppedEarly = true;
      break;
    }

    // Run the round's tools together, and return every result in one message.
    const results = await Promise.all(
      toolUses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
        toolCalls.push({ name: use.name, input: use.input });
        try {
          return {
            type: 'tool_result',
            tool_use_id: use.id,
            content: await runTool(use.name, use.input, context),
          };
        } catch {
          return {
            type: 'tool_result',
            tool_use_id: use.id,
            content: 'That lookup failed. Say you cannot check it right now.',
            is_error: true,
          };
        }
      })
    );

    messages.push({ role: 'user', content: results });
  }

  return {
    text: text.trim(),
    messages,
    toolCalls,
    escalation: context.escalation ?? null,
    proposals: context.proposals,
    usage,
    stoppedEarly,
  };
}

/**
 * A single-shot call with no tools — summarising an email, tightening a draft,
 * extracting structure from a transcript.
 */
export async function runOnce(options: {
  system: string;
  prompt: string;
  effort?: Effort;
  maxTokens?: number;
}): Promise<string> {
  const client = anthropic();
  const response = await client.messages.create({
    model: model(),
    max_tokens: options.maxTokens ?? 2000,
    system: options.system,
    messages: [{ role: 'user', content: options.prompt }],
    output_config: { effort: options.effort ?? EFFORT.email },
  });

  if (response.stop_reason === 'refusal') {
    return 'That could not be answered.';
  }
  return textOf(response);
}

/**
 * A single-shot call that must return JSON matching a schema.
 *
 * Used for after-call extraction, where the output feeds a database row rather
 * than a person's eyes. The schema is enforced by the API rather than by
 * hoping the model returns clean JSON.
 */
export async function runStructured<T>(options: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  effort?: Effort;
  maxTokens?: number;
}): Promise<T | null> {
  const client = anthropic();

  const response = await client.messages.create({
    model: model(),
    max_tokens: options.maxTokens ?? 4000,
    system: options.system,
    messages: [{ role: 'user', content: options.prompt }],
    output_config: {
      effort: options.effort ?? EFFORT.assistant,
      format: { type: 'json_schema', schema: options.schema },
    },
  } as Anthropic.MessageCreateParamsNonStreaming);

  if (response.stop_reason === 'refusal') return null;

  const text = textOf(response);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
