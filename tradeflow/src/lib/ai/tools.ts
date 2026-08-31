import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatDate, formatMoney, todayInAustralia } from '@/lib/format';
import { formatMinutes } from '@/lib/calc';

/**
 * What the assistant can look up, and what it can do.
 *
 * Every executor here closes over one `businessId`, supplied by the caller
 * from a trusted source — the signed-in session for the office assistant, the
 * dialled number for a phone call. No tool takes a business id as an argument,
 * so there is no argument the model can produce that reaches another tenant's
 * data. That is the whole security model of this file, and it is why the
 * service-role client is safe to use here.
 *
 * The read tools are also scoped by *surface*: a phone caller's agent gets a
 * narrower set than the owner's, because a stranger on the phone should not be
 * able to ask what the business turned over last quarter.
 */

export type ToolSurface = 'phone' | 'assistant';

export interface ToolContext {
  businessId: string;
  surface: ToolSurface;
  /** Set on a phone call once the caller has been matched to a customer. */
  customerId?: string | null;
  /** Raised by the escalate tool so the caller can act on it after the turn. */
  escalation?: { reason: string; urgency: string } | null;
  /** Actions the agent proposed during the call, for the after-call review. */
  proposals: { kind: string; title: string; detail?: string; due?: string; priority?: string }[];
}

const READ_TOOLS: Anthropic.Tool[] = [
  {
    name: 'find_customer',
    description:
      'Find a customer by name, company, phone number or email. Use this when a caller gives ' +
      'their name or business and you need to know who they are. Returns at most five matches.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A name, company, phone number or email address.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'find_job',
    description:
      'Find a job by its number, its name, the site address or suburb, or the customer it ' +
      'belongs to. Use this the moment a caller mentions a street, a suburb or "the job" — ' +
      'do not ask them which job until this has come back empty or ambiguous.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Job number, job name, street, suburb, or customer name.',
        },
        customer_id: {
          type: 'string',
          description: 'Optional. Restrict to one customer when you already know who is calling.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_job',
    description:
      'Everything about one job: status, dates, who is on it, the last few site reports and ' +
      'the most recent activity. Use this once you know which job is being discussed.',
    input_schema: {
      type: 'object',
      properties: { job_id: { type: 'string' } },
      required: ['job_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_schedule',
    description:
      'Jobs scheduled or under way, with their expected completion dates. Use this for ' +
      '"when is someone coming?" and "what is on today?".',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string', description: 'Optional. Restrict to one customer.' },
        days: { type: 'number', description: 'How many days ahead to look. Default 14.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'get_open_tasks',
    description:
      'Outstanding tasks, optionally for one job. Use this for "what do I need to do?" and to ' +
      'check whether a caller\'s earlier request was already written down.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'string' },
        overdue_only: { type: 'boolean' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'get_call_history',
    description:
      'Previous calls from this customer, most recent first, with what each was about. Use ' +
      'this when someone says they have called before, or sounds like they are chasing ' +
      'something up.',
    input_schema: {
      type: 'object',
      properties: { customer_id: { type: 'string' } },
      required: ['customer_id'],
      additionalProperties: false,
    },
  },
];

/** Only the office assistant sees money. */
const FINANCIAL_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_invoices',
    description:
      'Invoices, filtered by status. Use for "which invoices are overdue?" and "show me my ' +
      'outstanding money".',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['overdue', 'unpaid', 'paid', 'draft', 'all'],
          description: 'Default "unpaid".',
        },
        customer_id: { type: 'string' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'get_quotes',
    description:
      'Quotes, filtered by status. Use for "which quotes have not been accepted?".',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'accepted', 'declined', 'all'],
          description: 'Default "open" — sent and awaiting an answer.',
        },
        customer_id: { type: 'string' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'get_business_summary',
    description:
      'The headline figures: revenue, outstanding, overdue, open quotes, active jobs, tasks ' +
      'due, expenses. Use this for "how are we going?" and as a starting point for most ' +
      'money questions.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'get_job_profitability',
    description: 'What one job was invoiced, what it cost, and the margin.',
    input_schema: {
      type: 'object',
      properties: { job_id: { type: 'string' } },
      required: ['job_id'],
      additionalProperties: false,
    },
  },
];

/** Write tools. On a call these propose; they do not commit. */
const ACTION_TOOLS: Anthropic.Tool[] = [
  {
    name: 'propose_task',
    description:
      'Record something the caller has asked for, so the business sees it after the call. Use ' +
      'this whenever a caller wants something done — an inspection, a call back, a repair, a ' +
      'quote. Call it once per distinct request. It does not create the task immediately; a ' +
      'person confirms it. Tell the caller you have made a note of it.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The action, as an instruction. "Inspect crack near window at 15 King Street".',
        },
        detail: { type: 'string', description: 'What the caller actually said, in their words.' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        due_date: { type: 'string', description: 'YYYY-MM-DD if a deadline was mentioned.' },
        job_id: { type: 'string', description: 'The job it relates to, if known.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'escalate',
    description:
      'Flag that this call needs a person. Use it when the caller asks for a human, when they ' +
      'are angry, when it is a complaint, when it is an emergency, or when you have been asked ' +
      'something you are not allowed to answer. Say plainly that you will get it to the right ' +
      'person — do not promise when they will call.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why this needs a person, in one sentence.' },
        urgency: { type: 'string', enum: ['routine', 'today', 'urgent'] },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
];

export function toolsFor(surface: ToolSurface): Anthropic.Tool[] {
  // Tool order is fixed so the cached prefix stays byte-identical between turns.
  return surface === 'phone'
    ? [...READ_TOOLS, ...ACTION_TOOLS]
    : [...READ_TOOLS, ...FINANCIAL_TOOLS, ...ACTION_TOOLS];
}

// --- execution ---------------------------------------------------------------

type Input = Record<string, unknown>;

const str = (input: Input, key: string): string | null => {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
};

const like = (text: string) => `%${text.replace(/[,()\\%]/g, ' ').trim()}%`;

export async function runTool(
  name: string,
  rawInput: unknown,
  context: ToolContext
): Promise<string> {
  const input = (rawInput ?? {}) as Input;
  const admin = createAdminClient();
  const businessId = context.businessId;
  const today = todayInAustralia();

  try {
    switch (name) {
      case 'find_customer': {
        const query = str(input, 'query');
        if (!query) return 'No search term given.';
        const pattern = like(query);
        const digits = query.replace(/\D/g, '');

        const { data } = await admin
          .from('customers')
          .select('id, name, company, phone, email, suburb')
          .eq('business_id', businessId)
          .is('deleted_at', null)
          .or(
            `name.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern}` +
              (digits.length >= 6 ? `,phone.ilike.%${digits.slice(-8)}%` : '')
          )
          .limit(5);

        if (!data?.length) return `No customer matching "${query}".`;
        return data
          .map(
            (c) =>
              `${c.name}${c.company ? ` (${c.company})` : ''} — id ${c.id}` +
              `${c.suburb ? `, ${c.suburb}` : ''}${c.phone ? `, ${c.phone}` : ''}`
          )
          .join('\n');
      }

      case 'find_job': {
        const query = str(input, 'query');
        if (!query) return 'No search term given.';
        const pattern = like(query);

        let builder = admin
          .from('jobs')
          .select('id, number, name, status, site_address_line1, site_suburb, customer_id, expected_completion_date')
          .eq('business_id', businessId)
          .is('deleted_at', null);

        const customerId = str(input, 'customer_id') ?? context.customerId;
        if (customerId) builder = builder.eq('customer_id', customerId);

        const { data } = await builder
          .or(
            `number.ilike.${pattern},name.ilike.${pattern},site_address_line1.ilike.${pattern},site_suburb.ilike.${pattern},description.ilike.${pattern}`
          )
          .order('updated_at', { ascending: false })
          .limit(5);

        if (!data?.length) return `No job matching "${query}".`;
        return data
          .map(
            (j) =>
              `${j.number} — ${j.name} — id ${j.id} — ${j.status.replace(/_/g, ' ')}` +
              `${j.site_address_line1 ? ` at ${j.site_address_line1}` : ''}` +
              `${j.site_suburb ? `, ${j.site_suburb}` : ''}` +
              `${j.expected_completion_date ? `, due ${formatDate(j.expected_completion_date)}` : ''}`
          )
          .join('\n');
      }

      case 'get_job': {
        const jobId = str(input, 'job_id');
        if (!jobId) return 'No job id given.';

        const { data: job } = await admin
          .from('jobs')
          .select('*')
          .eq('id', jobId)
          .eq('business_id', businessId)
          .is('deleted_at', null)
          .maybeSingle();
        if (!job) return 'That job was not found.';

        // A phone caller only hears about their own job.
        if (context.surface === 'phone' && context.customerId && job.customer_id !== context.customerId) {
          return 'That job does not belong to this caller. Do not discuss it.';
        }

        const [{ data: reports }, { data: activities }, { data: customer }] = await Promise.all([
          admin
            .from('reports')
            .select('number, title, report_date, summary')
            .eq('job_id', jobId)
            .is('deleted_at', null)
            .order('report_date', { ascending: false })
            .limit(3),
          admin
            .from('activities')
            .select('summary, created_at')
            .eq('job_id', jobId)
            .order('created_at', { ascending: false })
            .limit(5),
          job.customer_id
            ? admin.from('customers').select('name, company').eq('id', job.customer_id).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

        const lines = [
          `${job.number} — ${job.name}`,
          `Status: ${job.status.replace(/_/g, ' ')}`,
          customer ? `Customer: ${customer.company || customer.name}` : null,
          [job.site_address_line1, job.site_suburb].filter(Boolean).join(', ') || null,
          job.start_date ? `Started ${formatDate(job.start_date)}` : null,
          job.expected_completion_date
            ? `Expected completion ${formatDate(job.expected_completion_date)}` +
              (job.expected_completion_date < today &&
              !['completed', 'invoiced', 'paid', 'cancelled'].includes(job.status)
                ? ' (PAST DUE)'
                : '')
            : 'No completion date set',
          job.description ? `Scope: ${job.description.slice(0, 400)}` : null,
        ].filter(Boolean);

        if (reports?.length) {
          lines.push(
            'Recent reports:',
            ...reports.map((r) => `  ${formatDate(r.report_date)} ${r.title}${r.summary ? ` — ${r.summary.slice(0, 160)}` : ''}`)
          );
        }
        if (activities?.length) {
          lines.push('Recent activity:', ...activities.map((a) => `  ${a.summary}`));
        }
        return lines.join('\n');
      }

      case 'get_schedule': {
        const days = typeof input.days === 'number' ? Math.min(Math.max(input.days, 1), 90) : 14;
        const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000)
          .toISOString()
          .slice(0, 10);

        let builder = admin
          .from('jobs')
          .select('number, name, status, start_date, expected_completion_date, site_suburb, customer_id')
          .eq('business_id', businessId)
          .is('deleted_at', null)
          .in('status', ['accepted', 'scheduled', 'in_progress']);

        const customerId = str(input, 'customer_id') ?? context.customerId;
        if (customerId) builder = builder.eq('customer_id', customerId);

        const { data } = await builder
          .order('start_date', { ascending: true, nullsFirst: false })
          .limit(20);

        if (!data?.length) return 'Nothing scheduled or under way.';
        return data
          .map(
            (j) =>
              `${j.number} ${j.name}${j.site_suburb ? ` (${j.site_suburb})` : ''} — ${j.status.replace(/_/g, ' ')}` +
              `${j.start_date ? `, starts ${formatDate(j.start_date)}` : ''}` +
              `${j.expected_completion_date ? `, due ${formatDate(j.expected_completion_date)}` : ''}` +
              `${j.expected_completion_date && j.expected_completion_date > horizon ? ' (beyond the window asked about)' : ''}`
          )
          .join('\n');
      }

      case 'get_open_tasks': {
        let builder = admin
          .from('job_tasks')
          .select('title, priority, status, due_date, job_id')
          .eq('business_id', businessId)
          .is('deleted_at', null)
          .in('status', ['open', 'in_progress']);

        const jobId = str(input, 'job_id');
        if (jobId) builder = builder.eq('job_id', jobId);
        if (input.overdue_only === true) builder = builder.lt('due_date', today);

        const { data } = await builder
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(20);

        if (!data?.length) return 'No outstanding tasks.';
        return data
          .map(
            (t) =>
              `${t.title} — ${t.priority}` +
              `${t.due_date ? `, due ${formatDate(t.due_date)}${t.due_date < today ? ' (OVERDUE)' : ''}` : ', no due date'}`
          )
          .join('\n');
      }

      case 'get_call_history': {
        const customerId = str(input, 'customer_id') ?? context.customerId;
        if (!customerId) return 'No customer identified, so there is no call history to read.';

        const { data } = await admin
          .from('calls')
          .select('started_at, summary, outcome, escalated, intent')
          .eq('business_id', businessId)
          .eq('customer_id', customerId)
          .is('deleted_at', null)
          .order('started_at', { ascending: false })
          .limit(5);

        if (!data?.length) return 'No previous calls from this customer.';
        return data
          .map(
            (c) =>
              `${formatDate(c.started_at.slice(0, 10))}: ${c.summary ?? c.intent ?? 'no summary'}` +
              `${c.outcome ? ` — ${c.outcome}` : ''}${c.escalated ? ' (was escalated)' : ''}`
          )
          .join('\n');
      }

      // --- financial, office assistant only ---------------------------------

      case 'get_invoices': {
        if (context.surface !== 'assistant') return 'Not available on a call.';
        const status = str(input, 'status') ?? 'unpaid';

        let builder = admin
          .from('invoices')
          .select('number, status, total_cents, paid_cents, due_date, customer_id, issue_date')
          .eq('business_id', businessId)
          .is('deleted_at', null);

        if (status === 'overdue') {
          builder = builder.lt('due_date', today).not('status', 'in', '("paid","draft","cancelled")');
        } else if (status === 'unpaid') {
          builder = builder.in('status', ['sent', 'viewed', 'partially_paid', 'overdue']);
        } else if (status === 'paid') {
          builder = builder.eq('status', 'paid');
        } else if (status === 'draft') {
          builder = builder.eq('status', 'draft');
        }

        const customerId = str(input, 'customer_id');
        if (customerId) builder = builder.eq('customer_id', customerId);

        const { data } = await builder.order('due_date', { ascending: true }).limit(25);
        if (!data?.length) return `No invoices matching "${status}".`;

        const customers = await namesFor(
          admin,
          'customers',
          data.map((i) => i.customer_id)
        );
        const total = data.reduce((n, i) => n + (i.total_cents - i.paid_cents), 0);

        return [
          `${data.length} invoice(s), ${formatMoney(total)} outstanding in total.`,
          ...data.map(
            (i) =>
              `${i.number} — ${customers.get(i.customer_id) ?? 'unknown customer'} — ` +
              `${formatMoney(i.total_cents - i.paid_cents)} outstanding of ${formatMoney(i.total_cents)}` +
              `${i.due_date ? `, due ${formatDate(i.due_date)}${i.due_date < today ? ' (OVERDUE)' : ''}` : ''}`
          ),
        ].join('\n');
      }

      case 'get_quotes': {
        if (context.surface !== 'assistant') return 'Not available on a call.';
        const status = str(input, 'status') ?? 'open';

        let builder = admin
          .from('quotes')
          .select('number, title, status, total_cents, issue_date, expiry_date, customer_id')
          .eq('business_id', businessId)
          .is('deleted_at', null);

        if (status === 'open') builder = builder.in('status', ['sent', 'viewed', 'changes_requested']);
        else if (status === 'accepted') builder = builder.eq('status', 'accepted');
        else if (status === 'declined') builder = builder.eq('status', 'declined');

        const customerId = str(input, 'customer_id');
        if (customerId) builder = builder.eq('customer_id', customerId);

        const { data } = await builder.order('issue_date', { ascending: false }).limit(25);
        if (!data?.length) return `No quotes matching "${status}".`;

        const customers = await namesFor(
          admin,
          'customers',
          data.map((q) => q.customer_id)
        );
        const total = data.reduce((n, q) => n + q.total_cents, 0);

        return [
          `${data.length} quote(s), ${formatMoney(total)} in total.`,
          ...data.map(
            (q) =>
              `${q.number} — ${q.title} — ${customers.get(q.customer_id) ?? 'unknown'} — ` +
              `${formatMoney(q.total_cents)} — ${q.status.replace(/_/g, ' ')}` +
              `${q.expiry_date ? `, valid to ${formatDate(q.expiry_date)}${q.expiry_date < today ? ' (EXPIRED)' : ''}` : ''}`
          ),
        ].join('\n');
      }

      case 'get_business_summary': {
        if (context.surface !== 'assistant') return 'Not available on a call.';
        const { data } = await admin.rpc('dashboard_summary', { target: businessId });
        if (!data) return 'The summary could not be read.';
        const s = data as unknown as Record<string, number>;

        return [
          `Revenue this year: ${formatMoney(s.revenue_cents ?? 0)}`,
          `Received in the last 30 days: ${formatMoney(s.revenue_30d_cents ?? 0)}`,
          `Outstanding: ${formatMoney(s.outstanding_cents ?? 0)}`,
          `Overdue: ${formatMoney(s.overdue_cents ?? 0)} across ${s.overdue_count ?? 0} invoice(s)`,
          `Open quotes: ${formatMoney(s.open_quotes_cents ?? 0)} across ${s.open_quotes_count ?? 0}`,
          `Active jobs: ${s.active_jobs ?? 0}`,
          `Tasks due: ${s.tasks_due ?? 0} of ${s.tasks_open ?? 0} open`,
          `Expenses this year: ${formatMoney(s.expenses_ytd_cents ?? 0)}`,
          `Unread email: ${s.unread_emails ?? 0}`,
        ].join('\n');
      }

      case 'get_job_profitability': {
        if (context.surface !== 'assistant') return 'Not available on a call.';
        const jobId = str(input, 'job_id');
        if (!jobId) return 'No job id given.';

        const { data: job } = await admin
          .from('jobs')
          .select('id')
          .eq('id', jobId)
          .eq('business_id', businessId)
          .maybeSingle();
        if (!job) return 'That job was not found.';

        const { data } = await admin.rpc('job_profitability', { p_job: jobId });
        if (!data) return 'No figures for that job.';
        const p = data as unknown as Record<string, number | null>;

        return [
          `Invoiced (ex GST): ${formatMoney(p.invoiced_ex_gst_cents ?? 0)}`,
          `Received: ${formatMoney(p.paid_cents ?? 0)}`,
          `Costs (ex GST): ${formatMoney(p.expenses_ex_gst_cents ?? 0)}`,
          `Profit: ${formatMoney(p.profit_cents ?? 0)} (${((p.margin_bp ?? 0) / 100).toFixed(1)}% margin)`,
          `Labour logged: ${formatMinutes(p.labour_minutes ?? 0)}`,
          p.budget_cents ? `Budget: ${formatMoney(p.budget_cents)}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      }

      // --- actions ----------------------------------------------------------

      case 'propose_task': {
        const title = str(input, 'title');
        if (!title) return 'A title is needed.';

        context.proposals.push({
          kind: 'task',
          title,
          detail: str(input, 'detail') ?? undefined,
          due: str(input, 'due_date') ?? undefined,
          priority: str(input, 'priority') ?? 'medium',
        });

        return (
          'Noted. It will be put in front of the team after the call. ' +
          'Tell the caller you have made a note of it — do not say a task has been created.'
        );
      }

      case 'escalate': {
        const reason = str(input, 'reason') ?? 'The caller asked for a person.';
        context.escalation = { reason, urgency: str(input, 'urgency') ?? 'routine' };
        return (
          'Flagged for a person. Tell the caller you will get it to the right person. ' +
          'Do not promise when they will be called back.'
        );
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch {
    // A failing lookup must not end a phone call. The agent is told plainly
    // that the tool did not work so it can say so rather than invent an answer.
    return 'That lookup did not work. Say you cannot check it right now and take a message.';
  }
}

async function namesFor(
  admin: ReturnType<typeof createAdminClient>,
  table: 'customers',
  ids: (string | null)[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const { data } = await admin.from(table).select('id, name, company').in('id', unique);
  for (const row of data ?? []) map.set(row.id, row.company || row.name);
  return map;
}
