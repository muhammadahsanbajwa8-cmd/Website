import { requireCapability } from '@/lib/session';
import { aiConfigured } from '@/lib/ai/client';
import { Card, CardBody, CardHeader, InfoNote, PageHeader } from '@/components/ui';
import { AssistantChat } from './chat';

export const metadata = { title: 'Assistant' };

export default async function AssistantPage() {
  const session = await requireCapability('ai.use');

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Assistant"
        description={`Ask about ${session.business.name} — it answers from your own records, and only yours.`}
      />

      {!aiConfigured() ? (
        <div className="mb-5">
          <InfoNote tone="warning">
            The assistant needs an Anthropic API key. Add <code>ANTHROPIC_API_KEY</code> to{' '}
            <code>.env.local</code> and restart. Nothing else in the platform depends on it.
          </InfoNote>
        </div>
      ) : null}

      <AssistantChat
        configured={aiConfigured()}
        canSeeMoney={session.can('dashboard.financials')}
        firstName={(session.profile?.full_name ?? session.email).split(/[\s@]/)[0] ?? ''}
      />

      <Card className="mt-5">
        <CardHeader title="What it can and cannot reach" />
        <CardBody>
          <p className="text-sm text-[var(--text-muted)]">
            Every lookup it makes is bound to {session.business.name} — the business id comes from
            your session, never from anything the assistant produces, so there is no question you
            could ask that reaches another business&rsquo;s records. Your role decides the rest:
            a worker&rsquo;s assistant has no access to pricing at all.
          </p>
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            It states figures; it does not give legal, tax or accounting advice.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
