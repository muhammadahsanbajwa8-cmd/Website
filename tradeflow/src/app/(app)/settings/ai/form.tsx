'use client';

import { useActionState, useState } from 'react';
import { saveBrainAction } from './actions';
import { idleState } from '@/lib/action-state';
import {
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  FormError,
  FormSuccess,
  Icon,
  InfoNote,
  Input,
  Select,
  Textarea,
  cn,
  icons,
} from '@/components/ui';
import { CopyButton, SubmitButton } from '@/components/ui/client';
import type { AiBrain, IndustryProfileRow, Json } from '@/lib/database.types';

const TONES = [
  { value: 'professional', label: 'Professional', sample: 'Good morning. How can I help you today?' },
  { value: 'friendly', label: 'Friendly', sample: "Hi there — what can I do for you?" },
  { value: 'casual', label: 'Casual', sample: "Hey, what's going on?" },
  { value: 'warm', label: 'Warm', sample: "Hello — I'm glad you called. What's happening?" },
  { value: 'concise', label: 'Concise', sample: 'How can I help?' },
  { value: 'formal', label: 'Formal', sample: 'Good morning. How may I be of assistance?' },
];

const VOICES = [
  { value: 'Polly.Nicole', label: 'Nicole — Australian, female' },
  { value: 'Polly.Russell', label: 'Russell — Australian, male' },
  { value: 'Polly.Olivia-Neural', label: 'Olivia — Australian, female, neural' },
  { value: 'Polly.Amy-Neural', label: 'Amy — British, female, neural' },
  { value: 'alice', label: 'Alice — standard' },
];

const DAYS = [
  ['monday', 'Monday'],
  ['tuesday', 'Tuesday'],
  ['wednesday', 'Wednesday'],
  ['thursday', 'Thursday'],
  ['friday', 'Friday'],
  ['saturday', 'Saturday'],
  ['sunday', 'Sunday'],
] as const;

function hoursValue(hours: Json, day: string): string {
  if (!hours || typeof hours !== 'object' || Array.isArray(hours)) return '';
  const value = (hours as Record<string, unknown>)[day];
  return typeof value === 'string' ? value : '';
}

function staffText(staff: Json): string {
  if (!Array.isArray(staff)) return '';
  return staff
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      return [record.name, record.role, record.note].filter(Boolean).join(' — ');
    })
    .filter(Boolean)
    .join('\n');
}

export function BrainForm({
  brain,
  industries,
  businessName,
  canEdit,
  appUrl,
}: {
  brain: AiBrain;
  industries: IndustryProfileRow[];
  businessName: string;
  canEdit: boolean;
  appUrl: string;
}) {
  const [state, action] = useActionState(saveBrainAction, idleState);
  const [tone, setTone] = useState(brain.tone as string);
  const [discloses, setDiscloses] = useState(brain.disclose_ai);
  const [greeting, setGreeting] = useState(brain.greeting ?? `Hi, you've reached ${businessName}.`);
  const [industryKey, setIndustryKey] = useState(brain.industry_key ?? 'other');

  const industry = industries.find((profile) => profile.key === industryKey);
  const spoken = `${greeting}${discloses ? " I'm the company's AI assistant." : ''} How can I help?`
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <form action={action} className="space-y-5">
      <FormError>{state.error}</FormError>
      {state.ok && state.message ? <FormSuccess>{state.message}</FormSuccess> : null}

      {/* --- what it sounds like ------------------------------------------ */}
      <Card>
        <CardHeader
          title="How it answers"
          description="What a caller hears in the first three seconds."
        />
        <CardBody className="space-y-5">
          <Field label="Greeting" htmlFor="greeting" hint="Your own words. Keep it to one line.">
            <Input
              id="greeting"
              name="greeting"
              value={greeting}
              onChange={(event) => setGreeting(event.target.value)}
              disabled={!canEdit}
            />
          </Field>

          <div className="rounded-[0.625rem] border border-[var(--line-subtle)] bg-[var(--surface-sunken)] p-4">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              <Icon path={icons.phone} size={14} />
              What the caller hears
            </div>
            <p className="text-sm italic text-[var(--text-strong)]">&ldquo;{spoken}&rdquo;</p>
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-[var(--text-strong)]">Tone</span>
            <input type="hidden" name="tone" value={tone} />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TONES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setTone(option.value)}
                  className={cn(
                    'rounded-[0.625rem] border p-3 text-left transition-colors',
                    tone === option.value
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--line-subtle)] hover:border-[var(--line-strong)]'
                  )}
                >
                  <span
                    className={cn(
                      'block text-sm font-medium',
                      tone === option.value ? 'text-[var(--accent)]' : 'text-[var(--text-strong)]'
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs italic text-[var(--text-muted)]">
                    &ldquo;{option.sample}&rdquo;
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Voice" htmlFor="voiceName">
              <Select id="voiceName" name="voiceName" defaultValue={brain.voice_name} disabled={!canEdit}>
                {VOICES.map((voice) => (
                  <option key={voice.value} value={voice.value}>
                    {voice.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Speaking speed" htmlFor="speakingRate" hint="1.0 is normal.">
              <Input
                id="speakingRate"
                name="speakingRate"
                type="number"
                step="0.05"
                min="0.5"
                max="2"
                defaultValue={brain.speaking_rate}
                disabled={!canEdit}
              />
            </Field>

            <Field label="Language" htmlFor="language">
              <Select id="language" name="language" defaultValue={brain.language} disabled={!canEdit}>
                <option value="en-AU">English (Australia)</option>
                <option value="en-GB">English (UK)</option>
                <option value="en-US">English (US)</option>
                <option value="en-NZ">English (New Zealand)</option>
              </Select>
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="After-hours greeting"
              htmlFor="afterHoursGreeting"
              hint="Used outside the hours below. Blank uses the normal greeting plus a note."
            >
              <Textarea
                id="afterHoursGreeting"
                name="afterHoursGreeting"
                rows={2}
                defaultValue={brain.after_hours_greeting ?? ''}
                disabled={!canEdit}
              />
            </Field>

            <Field
              label="When the assistant is off"
              htmlFor="voicemailGreeting"
              hint="Played if a call arrives while the assistant is switched off."
            >
              <Textarea
                id="voicemailGreeting"
                name="voicemailGreeting"
                rows={2}
                defaultValue={brain.voicemail_greeting ?? ''}
                disabled={!canEdit}
              />
            </Field>
          </div>

          <Checkbox
            name="discloseAi"
            defaultChecked={brain.disclose_ai}
            onChange={(event) => setDiscloses(event.currentTarget.checked)}
            disabled={!canEdit}
            label="Say it is an AI assistant when answering"
            description="Recommended, and required in some places. Turning this off removes the standing line from the greeting — the assistant will still answer honestly if a caller asks whether it is a person."
          />
        </CardBody>
      </Card>

      {/* --- what it knows ------------------------------------------------- */}
      <Card>
        <CardHeader title="What it knows about you" description="Read out on calls, and used to answer questions." />
        <CardBody className="space-y-5">
          <Field
            label="Your trade"
            htmlFor="industryKey"
            hint="Sets the vocabulary the assistant understands when a caller uses it."
          >
            <Select
              id="industryKey"
              name="industryKey"
              value={industryKey}
              onChange={(event) => setIndustryKey(event.target.value)}
              disabled={!canEdit}
            >
              {industries.map((profile) => (
                <option key={profile.key} value={profile.key}>
                  {profile.name}
                </option>
              ))}
            </Select>
          </Field>

          {industry && industry.terminology.length > 0 ? (
            <div className="rounded-[0.625rem] bg-[var(--surface-sunken)] p-3.5">
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
                Words it will understand on a call
              </div>
              <p className="text-sm text-[var(--text-default)]">
                {industry.terminology.slice(0, 24).join(' · ')}
                {industry.terminology.length > 24 ? ` · and ${industry.terminology.length - 24} more` : ''}
              </p>
            </div>
          ) : null}

          <Field label="Services" htmlFor="services" hint="One per line.">
            <Textarea
              id="services"
              name="services"
              rows={4}
              defaultValue={brain.services.join('\n')}
              placeholder={'Bricklaying\nBlocklaying\nRetaining walls\nRepairs'}
              disabled={!canEdit}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Service area" htmlFor="serviceArea">
              <Input
                id="serviceArea"
                name="serviceArea"
                defaultValue={brain.service_area ?? ''}
                placeholder="Perth metropolitan area"
                disabled={!canEdit}
              />
            </Field>
            <Field label="After-hours and emergencies" htmlFor="emergencyHours">
              <Input
                id="emergencyHours"
                name="emergencyHours"
                defaultValue={brain.emergency_hours ?? ''}
                placeholder="Emergency call-outs only, at the after-hours rate"
                disabled={!canEdit}
              />
            </Field>
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-[var(--text-strong)]">
              Business hours
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {DAYS.map(([key, label]) => (
                <label key={key} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm text-[var(--text-muted)]">{label}</span>
                  <Input
                    name={`hours.${key}`}
                    defaultValue={hoursValue(brain.business_hours, key)}
                    placeholder={key === 'saturday' || key === 'sunday' ? 'Closed' : '7:00am – 5:00pm'}
                    disabled={!canEdit}
                    className="h-10 py-0"
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              A call outside these hours gets the after-hours greeting, and is marked as
              after-hours in the call log.
            </p>
          </div>

          <Field
            label="Your people"
            htmlFor="staff"
            hint='One per line: "John — supervisor — on site most days". So "is John about?" gets a sensible answer.'
          >
            <Textarea
              id="staff"
              name="staff"
              rows={4}
              defaultValue={staffText(brain.staff)}
              placeholder={'John — supervisor — on site most days\nSarah — office manager — best for accounts'}
              disabled={!canEdit}
            />
          </Field>
        </CardBody>
      </Card>

      {/* --- the boundaries ------------------------------------------------ */}
      <Card>
        <CardHeader
          title="What it may and may not say"
          description="These are enforced on every call, not filtered afterwards."
        />
        <CardBody className="space-y-5">
          <div className="space-y-1">
            <Checkbox
              name="mayShareJobStatus"
              defaultChecked={brain.may_share_job_status}
              disabled={!canEdit}
              label="Tell a recognised customer how their own job is going"
              description="Only their jobs, and only when their number matches a customer on file."
            />
            <Checkbox
              name="mayDiscussPricing"
              defaultChecked={brain.may_discuss_pricing}
              disabled={!canEdit}
              label="Discuss indicative pricing"
              description="Off by default. With it off the assistant says a quote has to come from the team and takes their details."
            />
            <Checkbox
              name="mayConfirmBookings"
              defaultChecked={brain.may_confirm_bookings}
              disabled={!canEdit}
              label="Confirm a booking"
              description="Off by default. With it off the assistant says someone will call to lock in a time."
            />
          </div>

          <Field
            label="Pricing guidance"
            htmlFor="pricingGuidance"
            hint="Only used if pricing is switched on above. Ranges, not exact figures."
          >
            <Textarea
              id="pricingGuidance"
              name="pricingGuidance"
              rows={2}
              defaultValue={brain.pricing_guidance ?? ''}
              placeholder="Call-out is $180 plus GST. Retaining walls start around $450 a lineal metre. Always subject to a site visit."
              disabled={!canEdit}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Things it may talk about"
              htmlFor="allowedTopics"
              hint="One per line. Leave blank for no restriction beyond the rules above."
            >
              <Textarea
                id="allowedTopics"
                name="allowedTopics"
                rows={4}
                defaultValue={brain.allowed_topics.join('\n')}
                placeholder={'Job progress\nBooking a site visit\nWhat we do and where'}
                disabled={!canEdit}
              />
            </Field>

            <Field
              label="Things it must never say"
              htmlFor="forbiddenTopics"
              hint="One per line. The assistant refuses these under any framing."
            >
              <Textarea
                id="forbiddenTopics"
                name="forbiddenTopics"
                rows={4}
                defaultValue={brain.forbidden_topics.join('\n')}
                placeholder={'Anything about other customers\nStaff pay or personal details\nWho else we are quoting against\nLegal liability for a defect'}
                disabled={!canEdit}
              />
            </Field>
          </div>

          <Field
            label="House rules"
            htmlFor="policies"
            hint="Anything else, in your own words. This goes into the assistant's instructions as written."
          >
            <Textarea
              id="policies"
              name="policies"
              rows={4}
              defaultValue={brain.policies ?? ''}
              placeholder={
                'Never commit to a start date — Sarah does the scheduling.\n' +
                'If a caller mentions water coming in, treat it as urgent and escalate.\n' +
                'We do not do work on strata common property.'
              }
              disabled={!canEdit}
            />
          </Field>
        </CardBody>
      </Card>

      {/* --- escalation and the phone line --------------------------------- */}
      <Card>
        <CardHeader
          title="When it needs a person"
          description="Callers who ask for a human, complaints, and anything urgent."
        />
        <CardBody className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Who to escalate to" htmlFor="escalationName">
              <Input
                id="escalationName"
                name="escalationName"
                defaultValue={brain.escalation_name ?? ''}
                placeholder="Sarah"
                disabled={!canEdit}
              />
            </Field>
            <Field
              label="Transfer to this number"
              htmlFor="escalationPhone"
              hint="Set this and an escalated call is transferred, not just flagged."
            >
              <Input
                id="escalationPhone"
                name="escalationPhone"
                type="tel"
                defaultValue={brain.escalation_phone ?? ''}
                disabled={!canEdit}
              />
            </Field>
            <Field label="Notify this address" htmlFor="escalationEmail">
              <Input
                id="escalationEmail"
                name="escalationEmail"
                type="email"
                defaultValue={brain.escalation_email ?? ''}
                disabled={!canEdit}
              />
            </Field>
          </div>

          <Field
            label="Longest call"
            htmlFor="maxCallMinutes"
            hint="Minutes. The assistant winds the call up politely at this point."
          >
            <Input
              id="maxCallMinutes"
              name="maxCallMinutes"
              type="number"
              min={1}
              max={60}
              defaultValue={brain.max_call_minutes}
              className="max-w-32"
              disabled={!canEdit}
            />
          </Field>
        </CardBody>
      </Card>

      {/* --- the phone line ------------------------------------------------ */}
      <Card>
        <CardHeader title="The phone line" description="Connect a number and switch it on." />
        <CardBody className="space-y-5">
          <Checkbox
            name="enabled"
            defaultChecked={brain.enabled}
            disabled={!canEdit}
            label="Answer calls on the number below"
            description="With this off, calls to the number hear the message above and the assistant does not answer. Test calls from the Calls page work either way."
          />

          <Field
            label="Phone number"
            htmlFor="phoneNumber"
            hint="In the same format your provider sends it, usually +61…"
          >
            <Input
              id="phoneNumber"
              name="phoneNumber"
              type="tel"
              defaultValue={brain.phone_number ?? ''}
              placeholder="+61812345678"
              disabled={!canEdit}
            />
          </Field>

          <InfoNote>
            <p className="font-medium">Pointing a number at this</p>
            <p className="mt-1">
              A phone number has to be bought from a telephony provider, which is the one part of
              this that needs an account you set up yourself. Point the number&rsquo;s webhooks at
              these URLs and set <code>TWILIO_AUTH_TOKEN</code> so requests can be verified:
            </p>
            <div className="mt-3 space-y-2">
              {[
                ['A call comes in', `${appUrl}/api/voice/incoming`],
                ['Call status changes', `${appUrl}/api/voice/status`],
              ].map(([label, url]) => (
                <div key={url} className="flex flex-wrap items-center gap-2">
                  <span className="w-40 shrink-0 text-xs text-[var(--text-muted)]">{label}</span>
                  <code className="min-w-0 flex-1 break-all rounded bg-[var(--surface-card)] px-2 py-1 text-xs">
                    {url}
                  </code>
                  <CopyButton value={url} label="Copy" />
                </div>
              ))}
            </div>
          </InfoNote>
        </CardBody>
      </Card>

      {canEdit ? (
        <div className="sticky bottom-24 z-10 flex justify-end lg:bottom-6">
          <SubmitButton size="lg" pendingLabel="Saving…" className="shadow-[var(--shadow-raised)]">
            Save the assistant
          </SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
