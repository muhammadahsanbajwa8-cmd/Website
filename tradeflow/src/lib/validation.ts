/**
 * Server-side validation.
 *
 * Every server action parses its FormData through a schema here before it
 * touches the database. The browser's own `required` attributes are a
 * convenience; these are the rules.
 */

import { z } from 'zod';
import { isValidAbn } from './format';

const trimmed = (max: number) => z.string().trim().max(max);
const required = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const optionalEmail = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()
  .refine((v) => v === null || v === undefined || z.string().email().safeParse(v).success, {
    message: 'Enter a valid email address',
  });

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()
  .refine((v) => v === null || v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: 'Enter a valid date',
  });

const optionalAbn = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, ''))
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()
  .refine((v) => v === null || v === undefined || isValidAbn(v), {
    message: 'That ABN does not pass the ATO checksum',
  });

const optionalPostcode = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()
  .refine((v) => v === null || v === undefined || /^\d{4}$/.test(v), {
    message: 'An Australian postcode is four digits',
  });

const centsField = z.coerce.number().int().min(0).max(9_999_999_999);
const bpField = z.coerce.number().int().min(0).max(100_000);

// --- auth -------------------------------------------------------------------

export const signUpSchema = z
  .object({
    fullName: required('Your name', 120),
    email: z.string().trim().email('Enter a valid email address'),
    password: z
      .string()
      .min(10, 'Use at least 10 characters')
      .max(200, 'That password is too long')
      .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), {
        message: 'Include at least one letter and one number',
      }),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'The two passwords do not match',
    path: ['confirmPassword'],
  });

export const signInSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
});

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(10, 'Use at least 10 characters')
      .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), {
        message: 'Include at least one letter and one number',
      }),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'The two passwords do not match',
    path: ['confirmPassword'],
  });

export const profileSchema = z.object({
  fullName: required('Your name', 120),
  phone: optionalText(40),
});

// --- business ---------------------------------------------------------------

export const onboardingSchema = z.object({
  name: required('Business name'),
  businessType: optionalText(80),
  abn: optionalAbn,
  email: optionalEmail,
  phone: optionalText(40),
  addressLine1: optionalText(200),
  suburb: optionalText(80),
  state: optionalText(8),
  postcode: optionalPostcode,
  gstRegistered: z.coerce.boolean().default(true),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(14),
});

export const businessSettingsSchema = z.object({
  name: required('Business name'),
  businessType: optionalText(80),
  abn: optionalAbn,
  email: optionalEmail,
  phone: optionalText(40),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  suburb: optionalText(80),
  state: optionalText(8),
  postcode: optionalPostcode,
  gstRegistered: z.coerce.boolean().default(true),
  defaultPaymentTermsDays: z.coerce.number().int().min(0).max(365).default(14),
  quoteValidityDays: z.coerce.number().int().min(1).max(365).default(30),
  defaultMarkupBp: bpField.default(1500),
  bankAccountName: optionalText(120),
  bankBsb: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v.replace(/\D/g, '')))
    .nullable()
    .optional()
    .refine((v) => v === null || v === undefined || /^\d{6}$/.test(v), {
      message: 'A BSB is six digits',
    }),
  bankAccountNumber: optionalText(20),
});

// --- CRM --------------------------------------------------------------------

export const customerSchema = z.object({
  name: required('Customer name'),
  company: optionalText(200),
  email: optionalEmail,
  phone: optionalText(40),
  abn: optionalAbn,
  contactPerson: optionalText(120),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  suburb: optionalText(80),
  state: optionalText(8),
  postcode: optionalPostcode,
  notes: optionalText(5000),
});

export const contactSchema = z.object({
  customerId: z.string().uuid(),
  name: required('Contact name', 120),
  role: optionalText(80),
  email: optionalEmail,
  phone: optionalText(40),
  isPrimary: z.coerce.boolean().default(false),
});

export const leadSchema = z.object({
  name: required('Lead name'),
  company: optionalText(200),
  email: optionalEmail,
  phone: optionalText(40),
  source: optionalText(80),
  description: optionalText(5000),
  status: z.enum(['new', 'contacted', 'qualified', 'quoted', 'won', 'lost']).default('new'),
  estimatedValueCents: centsField.optional(),
  siteAddress: optionalText(300),
  nextFollowUpAt: optionalDate,
  customerId: z.string().uuid().nullable().optional(),
});

// --- jobs -------------------------------------------------------------------

export const jobSchema = z
  .object({
    name: required('Job name'),
    customerId: z.string().uuid('Choose a customer').nullable().optional(),
    description: optionalText(10_000),
    siteAddressLine1: optionalText(200),
    siteSuburb: optionalText(80),
    siteState: optionalText(8),
    sitePostcode: optionalPostcode,
    status: z
      .enum([
        'lead', 'estimating', 'quote_sent', 'accepted', 'scheduled',
        'in_progress', 'on_hold', 'completed', 'invoiced', 'paid', 'cancelled',
      ])
      .default('lead'),
    startDate: optionalDate,
    expectedCompletionDate: optionalDate,
    budgetCents: centsField.optional(),
    notes: optionalText(10_000),
    assignedTeamMemberIds: z.array(z.string().uuid()).default([]),
  })
  .refine(
    (v) =>
      !v.startDate || !v.expectedCompletionDate || v.expectedCompletionDate >= v.startDate,
    { message: 'Completion cannot be before the start date', path: ['expectedCompletionDate'] }
  );

export const jobNoteSchema = z.object({
  jobId: z.string().uuid(),
  body: required('Note', 10_000),
});

export const taskSchema = z.object({
  title: required('Task title', 300),
  description: optionalText(5000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  status: z.enum(['open', 'in_progress', 'completed', 'verified']).default('open'),
  jobId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  dueDate: optionalDate,
  source: z
    .enum(['manual', 'email', 'report', 'defect', 'customer_request', 'ai'])
    .default('manual'),
  emailId: z.string().uuid().nullable().optional(),
  reportId: z.string().uuid().nullable().optional(),
});

// --- estimating -------------------------------------------------------------

export const estimateItemSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(['labour', 'materials', 'equipment', 'travel', 'subcontractor', 'other']),
  description: required('Description', 500),
  quantityMilli: z.coerce.number().int().min(0).max(1_000_000_000),
  unit: trimmed(20).default('each'),
  unitCostCents: centsField,
  taxable: z.coerce.boolean().default(true),
});

export const estimateSchema = z.object({
  title: required('Estimate title'),
  customerId: z.string().uuid().nullable().optional(),
  jobId: z.string().uuid().nullable().optional(),
  notes: optionalText(10_000),
  status: z.enum(['draft', 'ready', 'converted', 'archived']).default('draft'),
  markupBp: bpField.default(1500),
  contingencyBp: bpField.default(0),
  gstBp: z.coerce.number().int().min(0).max(10_000).default(1000),
  gstApplies: z.coerce.boolean().default(true),
  items: z.array(estimateItemSchema).min(1, 'An estimate needs at least one line'),
});

// --- quotes -----------------------------------------------------------------

export const documentItemSchema = z.object({
  id: z.string().uuid().optional(),
  description: required('Description', 500),
  detail: optionalText(2000),
  quantityMilli: z.coerce.number().int().min(0).max(1_000_000_000),
  unit: trimmed(20).default('each'),
  unitPriceCents: z.coerce.number().int().min(-9_999_999_999).max(9_999_999_999),
  taxable: z.coerce.boolean().default(true),
});

export const quoteSchema = z.object({
  title: required('Quote title'),
  customerId: z.string().uuid('Choose a customer'),
  jobId: z.string().uuid().nullable().optional(),
  estimateId: z.string().uuid().nullable().optional(),
  scopeOfWork: optionalText(20_000),
  terms: optionalText(20_000),
  paymentTerms: optionalText(2000),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid issue date'),
  expiryDate: optionalDate,
  gstBp: z.coerce.number().int().min(0).max(10_000).default(1000),
  gstApplies: z.coerce.boolean().default(true),
  discountCents: centsField.default(0),
  items: z.array(documentItemSchema).min(1, 'A quote needs at least one line'),
});

export const quoteResponseSchema = z.object({
  action: z.enum(['accept', 'decline', 'request_changes', 'message']),
  name: z.string().trim().max(120).optional(),
  message: z.string().trim().max(5000).optional(),
});

// --- invoices ---------------------------------------------------------------

export const invoiceSchema = z
  .object({
    title: optionalText(200),
    customerId: z.string().uuid('Choose a customer'),
    jobId: z.string().uuid().nullable().optional(),
    quoteId: z.string().uuid().nullable().optional(),
    issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid issue date'),
    dueDate: optionalDate,
    paymentTerms: optionalText(2000),
    notes: optionalText(20_000),
    bankDetails: optionalText(2000),
    gstBp: z.coerce.number().int().min(0).max(10_000).default(1000),
    gstApplies: z.coerce.boolean().default(true),
    discountCents: centsField.default(0),
    items: z.array(documentItemSchema).min(1, 'An invoice needs at least one line'),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.issueDate, {
    message: 'The due date cannot be before the issue date',
    path: ['dueDate'],
  });

export const paymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.coerce.number().int().min(1, 'Enter an amount'),
  method: z.enum(['bank_transfer', 'card', 'cash', 'cheque', 'direct_debit', 'other']),
  reference: optionalText(120),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  notes: optionalText(2000),
});

// --- field work -------------------------------------------------------------

const optionalTime = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()
  .refine((v) => v === null || v === undefined || /^\d{2}:\d{2}(:\d{2})?$/.test(v), {
    message: 'Enter a time as HH:MM',
  });

export const workLogSchema = z.object({
  jobId: z.string().uuid('Choose a job'),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  startTime: optionalTime,
  finishTime: optionalTime,
  breakMinutes: z.coerce.number().int().min(0).max(1440).default(0),
  workerCount: z.coerce.number().int().min(0).max(500).default(1),
  workCompleted: optionalText(10_000),
  materialsUsed: optionalText(5000),
  equipmentUsed: optionalText(5000),
  weather: optionalText(200),
  problems: optionalText(5000),
  notes: optionalText(5000),
});

export const expenseSchema = z.object({
  description: required('Description', 300),
  category: z.enum(['labour', 'materials', 'equipment', 'travel', 'subcontractor', 'other']),
  amountCents: z.coerce.number().int().min(0, 'Enter an amount'),
  gstCents: centsField.default(0),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  jobId: z.string().uuid().nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  reference: optionalText(120),
  billable: z.coerce.boolean().default(false),
  notes: optionalText(2000),
});

export const reportSchema = z.object({
  templateKey: required('Template', 60),
  title: required('Report title'),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  jobId: z.string().uuid().nullable().optional(),
  customerId: z.string().uuid().nullable().optional(),
  status: z.enum(['draft', 'final', 'sent']).default('draft'),
  summary: optionalText(10_000),
  signatureName: optionalText(120),
  data: z.record(z.string(), z.unknown()).default({}),
  photoIds: z.array(z.string().uuid()).default([]),
});

export const photoSchema = z.object({
  jobId: z.string().uuid().nullable().optional(),
  reportId: z.string().uuid().nullable().optional(),
  caption: optionalText(500),
  category: z
    .enum(['general', 'before', 'during', 'after', 'defect', 'safety', 'compliance', 'damage'])
    .default('general'),
});

// --- catalogue --------------------------------------------------------------

export const supplierSchema = z.object({
  name: required('Supplier name'),
  contactPerson: optionalText(120),
  email: optionalEmail,
  phone: optionalText(40),
  address: optionalText(300),
  accountNumber: optionalText(80),
  notes: optionalText(2000),
});

export const materialSchema = z.object({
  name: required('Material name'),
  sku: optionalText(80),
  description: optionalText(2000),
  unit: trimmed(20).default('each'),
  unitCostCents: centsField.default(0),
  unitPriceCents: centsField.default(0),
  supplierId: z.string().uuid().nullable().optional(),
  taxable: z.coerce.boolean().default(true),
});

// --- team -------------------------------------------------------------------

export const inviteSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  fullName: optionalText(120),
  role: z.enum(['owner', 'admin', 'manager', 'worker', 'accountant']),
  phone: optionalText(40),
  hourlyRateCents: centsField.optional(),
});

// --- email ------------------------------------------------------------------

const addressList = z
  .string()
  .trim()
  .transform((v) =>
    v
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
  );

export const composeEmailSchema = z
  .object({
    to: addressList,
    cc: addressList.optional().default([]),
    bcc: addressList.optional().default([]),
    subject: required('Subject', 300),
    body: required('Message', 100_000),
    customerId: z.string().uuid().nullable().optional(),
    jobId: z.string().uuid().nullable().optional(),
    quoteId: z.string().uuid().nullable().optional(),
    invoiceId: z.string().uuid().nullable().optional(),
    reportId: z.string().uuid().nullable().optional(),
    threadId: z.string().uuid().nullable().optional(),
    attachQuoteId: z.string().uuid().nullable().optional(),
    attachInvoiceId: z.string().uuid().nullable().optional(),
    attachReportId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.to.length > 0, { message: 'Add at least one recipient', path: ['to'] })
  .refine(
    (v) => [...v.to, ...(v.cc ?? []), ...(v.bcc ?? [])].every((a) => z.string().email().safeParse(a).success),
    { message: 'One of those addresses is not valid', path: ['to'] }
  );

// --- AI ---------------------------------------------------------------------

export const assistantSchema = z.object({
  question: required('Question', 4000),
  jobId: z.string().uuid().nullable().optional(),
});

export const emailAssistSchema = z.object({
  emailId: z.string().uuid(),
  action: z.enum([
    'summarise',
    'draft_reply',
    'what_do_i_need_to_do',
    'create_task',
    'make_professional',
    'make_shorter',
    'create_report',
  ]),
  draft: z.string().max(50_000).optional(),
});

// --- helpers ----------------------------------------------------------------

export type FieldErrors = Record<string, string[]>;

/** Flatten a Zod failure into `{ field: [messages] }` for the form components. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_form';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** The first message, for a toast or a single-line summary. */
export function firstError(errors: FieldErrors): string | null {
  for (const messages of Object.values(errors)) {
    if (messages.length) return messages[0]!;
  }
  return null;
}
