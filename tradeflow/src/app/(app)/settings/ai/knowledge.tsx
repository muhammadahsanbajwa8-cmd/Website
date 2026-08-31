'use client';

import { useActionState } from 'react';
import {
  deleteFaqAction,
  deleteKnowledgeAction,
  saveFaqAction,
  saveKnowledgeAction,
} from './actions';
import { idleState } from '@/lib/action-state';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  FormError,
  FormSuccess,
  Icon,
  Input,
  Textarea,
  icons,
} from '@/components/ui';
import { ConfirmSubmit, Disclosure, SubmitButton } from '@/components/ui/client';
import type { AiFaq, AiKnowledge } from '@/lib/database.types';

/**
 * The two things a business writes for its own assistant: the answers to
 * questions it gets asked all day, and the notes that do not fit a question.
 *
 * Both are quoted rather than paraphrased on a call, which is why the wording
 * matters — an answer written here is what the caller hears.
 */
export function KnowledgePanels({
  faqs,
  knowledge,
  canEdit,
}: {
  faqs: AiFaq[];
  knowledge: AiKnowledge[];
  canEdit: boolean;
}) {
  const [faqState, faqAction] = useActionState(saveFaqAction, idleState);
  const [noteState, noteAction] = useActionState(saveKnowledgeAction, idleState);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Questions you get asked"
          description="Your answer, in your words. The assistant uses it verbatim."
        />

        {faqs.length === 0 ? (
          <CardBody>
            <p className="text-sm text-[var(--text-muted)]">
              Nothing yet. Start with the three questions you answer most on the phone.
            </p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-[var(--line-subtle)]">
            {faqs.map((faq) => (
              <li key={faq.id} className="flex items-start gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--text-strong)]">{faq.question}</p>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">{faq.answer}</p>
                  {faq.category ? (
                    <span className="mt-1.5 inline-block text-xs text-[var(--text-muted)]">
                      {faq.category}
                    </span>
                  ) : null}
                </div>
                {canEdit ? (
                  <form action={deleteFaqAction}>
                    <input type="hidden" name="id" value={faq.id} />
                    <ConfirmSubmit
                      confirmTitle="Remove this answer?"
                      confirmBody="The assistant will stop using it on calls."
                      confirmLabel="Remove"
                    >
                      <Icon path={icons.trash} size={14} />
                    </ConfirmSubmit>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <CardBody className="border-t border-[var(--line-subtle)]">
            <Disclosure summary="Add an answer">
              <form action={faqAction} className="space-y-4 pt-1">
                <FormError>{faqState.error}</FormError>
                {faqState.ok && faqState.message ? (
                  <FormSuccess>{faqState.message}</FormSuccess>
                ) : null}

                <Field label="Question" htmlFor="faq-question" error={faqState.fieldErrors?.question} required>
                  <Input
                    id="faq-question"
                    name="question"
                    required
                    placeholder="Do you do weekend work?"
                  />
                </Field>

                <Field label="Your answer" htmlFor="faq-answer" error={faqState.fieldErrors?.answer} required>
                  <Textarea
                    id="faq-answer"
                    name="answer"
                    rows={3}
                    required
                    placeholder="We work Monday to Friday. Saturdays are emergency call-outs only, at the after-hours rate."
                  />
                </Field>

                <Field label="Category" htmlFor="faq-category" hint="Optional. For your own sorting.">
                  <Input id="faq-category" name="category" placeholder="Scheduling" />
                </Field>

                <SubmitButton pendingLabel="Adding…">Add answer</SubmitButton>
              </form>
            </Disclosure>
          </CardBody>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Things it should know"
          description="Policies, quirks of the business, anything that does not fit a question."
        />

        {knowledge.length === 0 ? (
          <CardBody>
            <p className="text-sm text-[var(--text-muted)]">
              Nothing yet. Corrections you make when reviewing a call also land here.
            </p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-[var(--line-subtle)]">
            {knowledge.map((note) => (
              <li key={note.id} className="flex items-start gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-[var(--text-strong)]">{note.title}</p>
                    {note.category === 'correction' ? (
                      <Badge tone="info">From a call review</Badge>
                    ) : note.category !== 'general' ? (
                      <Badge>{note.category}</Badge>
                    ) : null}
                    {!note.approved ? <Badge tone="warning">Not in use</Badge> : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                    {note.body}
                  </p>
                </div>
                {canEdit ? (
                  <form action={deleteKnowledgeAction}>
                    <input type="hidden" name="id" value={note.id} />
                    <ConfirmSubmit
                      confirmTitle="Remove this note?"
                      confirmBody="The assistant will stop using it."
                      confirmLabel="Remove"
                    >
                      <Icon path={icons.trash} size={14} />
                    </ConfirmSubmit>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <CardBody className="border-t border-[var(--line-subtle)]">
            <Disclosure summary="Add a note">
              <form action={noteAction} className="space-y-4 pt-1">
                <FormError>{noteState.error}</FormError>
                {noteState.ok && noteState.message ? (
                  <FormSuccess>{noteState.message}</FormSuccess>
                ) : null}

                <Field label="Title" htmlFor="note-title" error={noteState.fieldErrors?.title} required>
                  <Input
                    id="note-title"
                    name="title"
                    required
                    placeholder="How we handle warranty callbacks"
                  />
                </Field>

                <Field label="What it should know" htmlFor="note-body" error={noteState.fieldErrors?.body} required>
                  <Textarea
                    id="note-body"
                    name="body"
                    rows={4}
                    required
                    placeholder="Anything within twelve months of practical completion is covered. Take the details and mark it urgent — do not tell the customer whether it is covered."
                  />
                </Field>

                <Field label="Category" htmlFor="note-category">
                  <Input id="note-category" name="category" defaultValue="general" />
                </Field>

                <Checkbox
                  name="approved"
                  defaultChecked
                  label="The assistant may use this on calls"
                  description="Uncheck to keep it as an internal note the assistant does not read."
                />

                <SubmitButton pendingLabel="Adding…">Add note</SubmitButton>
              </form>
            </Disclosure>
          </CardBody>
        ) : null}
      </Card>
    </div>
  );
}
