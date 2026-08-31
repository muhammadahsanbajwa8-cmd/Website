import Link from 'next/link';
import { requireBusiness } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { aiConfigured } from '@/lib/ai/client';
import { env } from '@/lib/env';
import { ButtonLink, Card, CardBody, CardHeader, Icon, InfoNote, PageHeader, icons } from '@/components/ui';
import { BrainForm } from './form';
import { KnowledgePanels } from './knowledge';
import type { AiBrain, AiFaq, AiKnowledge, IndustryProfileRow } from '@/lib/database.types';

export const metadata = { title: 'AI assistant' };

/**
 * The AI Business Brain.
 *
 * This is the page that makes the assistant specific to one business rather
 * than a generic bot. Everything on it goes into the system prompt of every
 * call and every question.
 */
export default async function AiSettingsPage() {
  const session = await requireBusiness();
  const supabase = await createClient();

  // Make sure the row exists before rendering the form against it.
  await supabase.rpc('ensure_ai_brain', { target: session.business.id });

  const [{ data: brain }, { data: industries }, { data: faqs }, { data: knowledge }, { count: feedbackCount }] =
    await Promise.all([
      supabase.from('ai_brain').select('*').eq('business_id', session.business.id).maybeSingle(),
      supabase
        .from('industry_profiles')
        .select('*')
        .or(`business_id.is.null,business_id.eq.${session.business.id}`)
        .order('name'),
      supabase
        .from('ai_faqs')
        .select('*')
        .eq('business_id', session.business.id)
        .is('deleted_at', null)
        .order('position')
        .order('created_at'),
      supabase
        .from('ai_knowledge')
        .select('*')
        .eq('business_id', session.business.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('ai_feedback')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', session.business.id)
        .eq('applied_to_brain', true),
    ]);

  const canEdit = ['owner', 'admin', 'manager'].includes(session.role);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Your AI assistant"
        description="Configured for your business — your services, your hours, your people, your words."
        breadcrumb={
          <Link href="/settings" className="hover:text-[var(--text-strong)]">
            Settings
          </Link>
        }
        actions={
          <ButtonLink href="/calls" variant="secondary">
            <Icon path={icons.phone} size={16} />
            Calls
          </ButtonLink>
        }
      />

      {!aiConfigured() ? (
        <div className="mb-5">
          <InfoNote tone="warning">
            <strong>No Anthropic API key is configured.</strong> You can set everything up on this
            page, but the assistant cannot answer until <code>ANTHROPIC_API_KEY</code> is added to{' '}
            <code>.env.local</code>. Nothing else in the platform is affected.
          </InfoNote>
        </div>
      ) : null}

      {!canEdit ? (
        <div className="mb-5">
          <InfoNote>
            You can see how the assistant is set up. Changing it is limited to owners, admins and
            managers.
          </InfoNote>
        </div>
      ) : null}

      {brain ? (
        <BrainForm
          brain={brain as AiBrain}
          industries={(industries ?? []) as IndustryProfileRow[]}
          businessName={session.business.name}
          canEdit={canEdit}
          appUrl={env.appUrl}
        />
      ) : (
        <Card>
          <CardBody>
            <p className="text-sm text-[var(--text-muted)]">
              The assistant could not be set up. Run <code>npm run db:push</code> to apply the
              latest migrations.
            </p>
          </CardBody>
        </Card>
      )}

      <div className="mt-5">
        <KnowledgePanels
          faqs={(faqs ?? []) as AiFaq[]}
          knowledge={(knowledge ?? []) as AiKnowledge[]}
          canEdit={canEdit}
        />
      </div>

      {(feedbackCount ?? 0) > 0 ? (
        <Card className="mt-5">
          <CardHeader
            title="Learning from your corrections"
            description={`${feedbackCount} correction${feedbackCount === 1 ? '' : 's'} from call reviews are now part of what it knows.`}
          />
          <CardBody>
            <p className="text-sm text-[var(--text-muted)]">
              When you mark a call as needing improvement and write what the assistant should have
              said, that becomes an approved knowledge note above — in your words. Your calls are
              never used to train a model; the improvement is that the right answer is now written
              down.
            </p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
