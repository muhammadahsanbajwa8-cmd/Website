'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { saveReportAction } from './actions';
import { idleState } from '@/lib/action-state';
import {
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  FormError,
  Icon,
  InfoNote,
  Input,
  Select,
  Textarea,
  buttonClass,
  icons,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';
import { PhotoUploader } from '@/components/photo-uploader';
import { todayInAustralia } from '@/lib/format';
import { wantsPhotos, wantsSignature, type ReportSection } from '@/lib/reports';
import type { CustomerOption, JobOption } from '@/lib/pickers';
import type { Report } from '@/lib/database.types';

export interface TemplateSummary {
  key: string;
  name: string;
  description: string | null;
}

/**
 * Filling in a report.
 *
 * Choosing a template navigates rather than swapping fields in place: the
 * sections come from the database, and a page load with the right fields beats
 * shipping every template's schema to the browser to pick one.
 */
export function ReportForm({
  report,
  templateKey,
  templateName,
  sections,
  templates,
  jobs,
  customers,
  defaultJobId,
  defaultCustomerId,
  attachedPhotoIds = [],
}: {
  report?: Report;
  templateKey: string;
  templateName: string;
  sections: ReportSection[];
  templates: TemplateSummary[];
  jobs: JobOption[];
  customers: CustomerOption[];
  defaultJobId?: string;
  defaultCustomerId?: string;
  attachedPhotoIds?: string[];
}) {
  const [state, action] = useActionState(saveReportAction, idleState);
  const answers = (report?.data ?? {}) as Record<string, unknown>;
  const today = todayInAustralia();
  const showsPhotos = wantsPhotos(sections);
  const showsSignature = wantsSignature(sections);

  return (
    <>
      <form action={action} className="space-y-5" noValidate>
        {report ? <input type="hidden" name="id" value={report.id} /> : null}
        <input type="hidden" name="templateKey" value={templateKey} />
        {attachedPhotoIds.map((photoId) => (
          <input key={photoId} type="hidden" name="photoIds" value={photoId} />
        ))}

        <FormError>{state.error}</FormError>

        <Card>
          <CardHeader
            title={templateName}
            description={
              report ? `Report ${report.number}` : 'A number is allocated when you save.'
            }
            action={
              !report && templates.length > 1 ? (
                <Link href="/reports/new" className={buttonClass('ghost', 'sm')}>
                  Change template
                </Link>
              ) : null
            }
          />
          <CardBody className="space-y-5">
            <Field label="Title" htmlFor="title" hint="Left blank, the template name and the date are used.">
              <Input
                id="title"
                name="title"
                defaultValue={report?.title ?? ''}
                placeholder={`${templateName} — 14 Wattle Street`}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Date" htmlFor="reportDate">
                <Input
                  id="reportDate"
                  name="reportDate"
                  type="date"
                  defaultValue={report?.report_date ?? today}
                />
              </Field>

              <Field label="Job" htmlFor="jobId">
                <Select id="jobId" name="jobId" defaultValue={report?.job_id ?? defaultJobId ?? ''}>
                  <option value="">Not linked to a job</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.number} — {job.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Customer" htmlFor="customerId">
                <Select
                  id="customerId"
                  name="customerId"
                  defaultValue={report?.customer_id ?? defaultCustomerId ?? ''}
                >
                  <option value="">Not linked to a customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.company ? `${customer.company} — ${customer.name}` : customer.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </CardBody>
        </Card>

        {sections.map((section) => {
          const fields = section.fields.filter(
            (field) => field.type !== 'photos' && field.type !== 'signature'
          );
          if (fields.length === 0) return null;

          return (
            <Card key={section.id}>
              <CardHeader title={section.title} />
              <CardBody className="space-y-5">
                {fields.map((field) => {
                  const name = `field.${field.id}`;
                  const value = answers[field.id];
                  const error = state.fieldErrors?.[name];

                  if (field.type === 'checkbox') {
                    return (
                      <Checkbox
                        key={field.id}
                        name={name}
                        defaultChecked={value === true}
                        label={field.label}
                        description={field.help}
                      />
                    );
                  }

                  return (
                    <Field
                      key={field.id}
                      label={field.label}
                      htmlFor={name}
                      hint={field.help}
                      error={error}
                      required={field.required}
                    >
                      {field.type === 'textarea' || field.type === 'table' ? (
                        <Textarea
                          id={name}
                          name={name}
                          rows={field.type === 'table' ? 5 : 3}
                          defaultValue={typeof value === 'string' ? value : ''}
                          required={field.required}
                          placeholder={field.type === 'table' ? 'One per line' : undefined}
                        />
                      ) : field.type === 'select' ? (
                        <Select
                          id={name}
                          name={name}
                          defaultValue={typeof value === 'string' ? value : ''}
                          required={field.required}
                        >
                          <option value="">Choose…</option>
                          {(field.options ?? []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          id={name}
                          name={name}
                          type={
                            field.type === 'date'
                              ? 'date'
                              : field.type === 'time'
                                ? 'time'
                                : field.type === 'number'
                                  ? 'number'
                                  : 'text'
                          }
                          inputMode={field.type === 'number' ? 'decimal' : undefined}
                          step={field.type === 'number' ? 'any' : undefined}
                          defaultValue={
                            typeof value === 'string' || typeof value === 'number' ? String(value) : ''
                          }
                          required={field.required}
                        />
                      )}
                    </Field>
                  );
                })}
              </CardBody>
            </Card>
          );
        })}

        <Card>
          <CardHeader title="Summary and sign-off" />
          <CardBody className="space-y-5">
            <Field
              label="Summary"
              htmlFor="summary"
              hint="Shown in lists and at the top of the PDF. Left blank, one is taken from the answers."
            >
              <Textarea id="summary" name="summary" rows={2} defaultValue={report?.summary ?? ''} />
            </Field>

            {showsSignature ? (
              <Field
                label="Signed by"
                htmlFor="signatureName"
                hint="Typing a name records it as signed, with the time."
              >
                <Input
                  id="signatureName"
                  name="signatureName"
                  defaultValue={report?.signature_name ?? ''}
                  autoComplete="name"
                />
              </Field>
            ) : null}

            <Field label="Status" htmlFor="status" hint="Required fields are only enforced once it is final.">
              <Select id="status" name="status" defaultValue={report?.status ?? 'draft'}>
                <option value="draft">Draft — still working on it</option>
                <option value="final">Final — ready to send</option>
              </Select>
            </Field>
          </CardBody>
        </Card>

        <div className="flex flex-wrap gap-2">
          <SubmitButton size="lg" pendingLabel="Saving…">
            {report ? 'Save report' : 'Save report'}
          </SubmitButton>
          <Link
            href={report ? `/reports/${report.id}` : '/reports'}
            className={buttonClass('secondary', 'lg')}
          >
            Cancel
          </Link>
        </div>
      </form>

      {/* Outside the report form: uploading is its own submission, so a photo
          added mid-report does not post a half-finished report with it. */}
      {showsPhotos ? (
        <Card className="mt-5">
          <CardHeader
            title="Photos"
            description={
              report
                ? 'Added straight onto this report.'
                : 'Save the report first, then add photos to it.'
            }
          />
          <CardBody>
            {report ? (
              <PhotoUploader reportId={report.id} jobId={report.job_id ?? undefined} />
            ) : (
              <InfoNote>
                <span className="flex items-center gap-2">
                  <Icon path={icons.camera} size={16} />
                  Save this report and the camera appears here.
                </span>
              </InfoNote>
            )}
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
