import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { applyCallActionAction, dismissCallActionAction, reprocessCallAction } from '../actions';
import {
  Badge,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Icon,
  InfoNote,
  PageHeader,
  cn,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { CallConsole } from './console';
import { CallReview } from './review';
import { formatDate, formatDateTime, formatPhone } from '@/lib/format';
import { taskPriority } from '@/lib/domain';
import type { Call, CallAction, CallTurn } from '@/lib/database.types';

export const metadata = { title: 'Call' };

const SENTIMENT = {
  positive: { label: 'Positive', tone: 'success' as const },
  neutral: { label: 'Neutral', tone: 'neutral' as const },
  frustrated: { label: 'Frustrated', tone: 'warning' as const },
  angry: { label: 'Angry', tone: 'danger' as const },
};

export default async function CallPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ console?: string }>;
}) {
  const session = await requireCapability('ai.use');
  const { id } = await params;
  const { console: consoleMode } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from('calls')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!data) notFound();
  const call = data as Call;

  const [{ data: turnRows }, { data: actionRows }, { data: customer }, { data: feedback }] =
    await Promise.all([
      supabase
        .from('call_turns')
        .select('*')
        .eq('call_id', id)
        .eq('business_id', session.business.id)
        .order('position'),
      supabase
        .from('call_actions')
        .select('*')
        .eq('call_id', id)
        .eq('business_id', session.business.id)
        .order('created_at'),
      call.customer_id
        ? supabase
            .from('customers')
            .select('id, name, company, phone')
            .eq('id', call.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('ai_feedback')
        .select('rating, correction, created_at')
        .eq('call_id', id)
        .eq('business_id', session.business.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const turns = (turnRows ?? []) as CallTurn[];
  const actions = (actionRows ?? []) as CallAction[];
  const pending = actions.filter((action) => !action.applied && !action.dismissed);
  const live = call.status === 'in_progress';
  const showConsole = live && call.provider === 'console' && consoleMode === '1';

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={
          customer
            ? `${customer.company || customer.name} called`
            : call.caller_name
              ? `${call.caller_name} called`
              : 'Call'
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{formatDateTime(call.started_at)}</span>
            {call.from_number ? (
              <>
                <span aria-hidden>·</span>
                <span>{formatPhone(call.from_number) || call.from_number}</span>
              </>
            ) : null}
            {call.duration_seconds ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  {Math.floor(call.duration_seconds / 60)}m {call.duration_seconds % 60}s
                </span>
              </>
            ) : null}
            {call.provider === 'console' ? (
              <>
                <span aria-hidden>·</span>
                <span>test call</span>
              </>
            ) : null}
          </span>
        }
        breadcrumb={
          <Link href="/calls" className="hover:text-[var(--text-strong)]">
            Calls
          </Link>
        }
        actions={
          !live ? (
            <form action={reprocessCallAction}>
              <input type="hidden" name="callId" value={call.id} />
              <SubmitButton variant="secondary" pendingLabel="Re-reading…">
                <Icon path={icons.ai} size={16} />
                Re-read the call
              </SubmitButton>
            </form>
          ) : null
        }
      />

      {call.escalated ? (
        <div className="mb-5">
          <InfoNote tone="warning">
            <strong>This call was escalated.</strong>{' '}
            {call.escalation_reason ?? 'The assistant handed it to a person.'}
          </InfoNote>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {call.summary ? (
            <Card>
              <CardHeader
                title="What happened"
                action={
                  call.sentiment ? (
                    <Badge tone={SENTIMENT[call.sentiment].tone}>
                      {SENTIMENT[call.sentiment].label}
                    </Badge>
                  ) : null
                }
              />
              <CardBody className="space-y-3">
                <p className="text-sm leading-relaxed text-[var(--text-default)]">{call.summary}</p>
                {call.outcome ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    <span className="font-medium text-[var(--text-strong)]">Outcome: </span>
                    {call.outcome}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          {/* What the caller asked for, waiting on a person. */}
          {actions.length > 0 ? (
            <Card>
              <CardHeader
                title="What the caller asked for"
                description={
                  pending.length > 0
                    ? `${pending.length} waiting on you. Nothing is created until you confirm it.`
                    : 'All dealt with.'
                }
              />
              <ul className="divide-y divide-[var(--line-subtle)]">
                {actions.map((action) => (
                  <li key={action.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'text-sm font-medium',
                              action.dismissed
                                ? 'text-[var(--text-muted)] line-through'
                                : 'text-[var(--text-strong)]'
                            )}
                          >
                            {action.title}
                          </span>
                          <Badge tone={taskPriority(action.priority).tone}>
                            {taskPriority(action.priority).label}
                          </Badge>
                          {action.kind !== 'task' ? (
                            <Badge>{action.kind.replace(/_/g, ' ')}</Badge>
                          ) : null}
                        </div>

                        {action.detail ? (
                          <p className="mt-1 text-sm text-[var(--text-muted)]">
                            &ldquo;{action.detail}&rdquo;
                          </p>
                        ) : null}

                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {action.due_date ? `Due ${formatDate(action.due_date)}` : 'No deadline given'}
                          {action.applied && action.task_id ? (
                            <>
                              {' · '}
                              <Link href={`/tasks/${action.task_id}`} className="text-[var(--accent)] hover:underline">
                                task created
                              </Link>
                            </>
                          ) : null}
                        </p>
                      </div>

                      {!action.applied && !action.dismissed && session.can('tasks.edit') ? (
                        <div className="flex shrink-0 gap-2">
                          <form action={applyCallActionAction}>
                            <input type="hidden" name="id" value={action.id} />
                            <SubmitButton size="sm" pendingLabel="Creating…">
                              <Icon path={icons.check} size={14} />
                              Create task
                            </SubmitButton>
                          </form>
                          <form action={dismissCallActionAction}>
                            <input type="hidden" name="id" value={action.id} />
                            <input type="hidden" name="callId" value={call.id} />
                            <SubmitButton size="sm" variant="ghost" pendingLabel="…">
                              Ignore
                            </SubmitButton>
                          </form>
                        </div>
                      ) : action.applied ? (
                        <Badge tone="success">Created</Badge>
                      ) : (
                        <Badge>Ignored</Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {/* The console, for a live test call. */}
          {showConsole ? <CallConsole callId={call.id} turns={turns} /> : null}

          {/* The transcript. */}
          {!showConsole ? (
            <Card>
              <CardHeader
                title="Transcript"
                description={`${turns.length} turn${turns.length === 1 ? '' : 's'}`}
              />
              <CardBody className="space-y-3">
                {turns.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">Nothing was said.</p>
                ) : (
                  turns.map((turn) => (
                    <div
                      key={turn.id}
                      className={cn(
                        'flex gap-3',
                        turn.role === 'agent' ? 'flex-row' : 'flex-row-reverse'
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[80%] rounded-[0.875rem] px-3.5 py-2.5 text-sm',
                          turn.role === 'agent'
                            ? 'bg-[var(--surface-sunken)] text-[var(--text-default)]'
                            : 'bg-[var(--accent-soft)] text-[var(--text-strong)]'
                        )}
                      >
                        <div className="mb-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                          {turn.role === 'agent' ? 'Assistant' : 'Caller'}
                          {turn.interrupted ? ' · cut in' : ''}
                          {turn.confidence != null && turn.confidence < 0.6
                            ? ' · unclear audio'
                            : ''}
                          {turn.latency_ms ? ` · ${(turn.latency_ms / 1000).toFixed(1)}s` : ''}
                        </div>
                        <p className="whitespace-pre-wrap">{turn.text}</p>
                      </div>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          ) : null}

          {!live ? (
            <CallReview
              callId={call.id}
              existing={feedback ? { rating: feedback.rating, correction: feedback.correction } : null}
            />
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Call details" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  {
                    label: 'Customer',
                    value: customer ? (
                      <Link href={`/customers/${customer.id}`} className="text-[var(--accent)] hover:underline">
                        {customer.company || customer.name}
                      </Link>
                    ) : (
                      'Not recognised'
                    ),
                  },
                  { label: 'Number', value: call.from_number ? formatPhone(call.from_number) || call.from_number : 'Withheld' },
                  { label: 'Started', value: formatDateTime(call.started_at) },
                  { label: 'Ended', value: call.ended_at ? formatDateTime(call.ended_at) : 'Still going' },
                  { label: 'About', value: call.intent ?? '—' },
                  { label: 'Outside hours', value: call.after_hours ? 'Yes' : 'No' },
                  { label: 'Handled by', value: call.handled_by_ai ? 'AI assistant' : 'A person' },
                ]}
              />
            </CardBody>
          </Card>

          {!customer && call.from_number ? (
            <Card>
              <CardBody>
                <h3 className="text-sm font-semibold text-[var(--text-strong)]">
                  Not a customer yet
                </h3>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  Add them and the assistant will recognise the number next time they ring.
                </p>
                <ButtonLink href="/customers/new" variant="secondary" size="sm" className="mt-3">
                  <Icon path={icons.plus} size={14} />
                  Add customer
                </ButtonLink>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
