/**
 * Domain vocabulary: the enum values from the database, with the words and
 * colours the interface shows for them. One definition, used by badges,
 * filters, forms and PDFs alike.
 */

export type JobStatus =
  | 'lead' | 'estimating' | 'quote_sent' | 'accepted' | 'scheduled'
  | 'in_progress' | 'on_hold' | 'completed' | 'invoiced' | 'paid' | 'cancelled';

export type QuoteStatus =
  | 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined'
  | 'changes_requested' | 'expired' | 'cancelled';

export type InvoiceStatus =
  | 'draft' | 'sent' | 'viewed' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'verified';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type EstimateStatus = 'draft' | 'ready' | 'converted' | 'archived';
export type ReportStatus = 'draft' | 'final' | 'sent';

export type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';

export interface StatusMeta<T extends string> {
  value: T;
  label: string;
  tone: Tone;
}

export const JOB_STATUSES: StatusMeta<JobStatus>[] = [
  { value: 'lead', label: 'Lead', tone: 'neutral' },
  { value: 'estimating', label: 'Estimating', tone: 'info' },
  { value: 'quote_sent', label: 'Quote sent', tone: 'info' },
  { value: 'accepted', label: 'Accepted', tone: 'success' },
  { value: 'scheduled', label: 'Scheduled', tone: 'progress' },
  { value: 'in_progress', label: 'In progress', tone: 'progress' },
  { value: 'on_hold', label: 'On hold', tone: 'warning' },
  { value: 'completed', label: 'Completed', tone: 'success' },
  { value: 'invoiced', label: 'Invoiced', tone: 'info' },
  { value: 'paid', label: 'Paid', tone: 'success' },
  { value: 'cancelled', label: 'Cancelled', tone: 'danger' },
];

/** Statuses that count as work in the field, for the dashboard and job board. */
export const ACTIVE_JOB_STATUSES: JobStatus[] = ['accepted', 'scheduled', 'in_progress'];

export const QUOTE_STATUSES: StatusMeta<QuoteStatus>[] = [
  { value: 'draft', label: 'Draft', tone: 'neutral' },
  { value: 'sent', label: 'Sent', tone: 'info' },
  { value: 'viewed', label: 'Viewed', tone: 'progress' },
  { value: 'accepted', label: 'Accepted', tone: 'success' },
  { value: 'declined', label: 'Declined', tone: 'danger' },
  { value: 'changes_requested', label: 'Changes requested', tone: 'warning' },
  { value: 'expired', label: 'Expired', tone: 'warning' },
  { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
];

export const OPEN_QUOTE_STATUSES: QuoteStatus[] = ['sent', 'viewed', 'changes_requested'];

export const INVOICE_STATUSES: StatusMeta<InvoiceStatus>[] = [
  { value: 'draft', label: 'Draft', tone: 'neutral' },
  { value: 'sent', label: 'Sent', tone: 'info' },
  { value: 'viewed', label: 'Viewed', tone: 'progress' },
  { value: 'partially_paid', label: 'Part paid', tone: 'warning' },
  { value: 'paid', label: 'Paid', tone: 'success' },
  { value: 'overdue', label: 'Overdue', tone: 'danger' },
  { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
];

export const UNPAID_INVOICE_STATUSES: InvoiceStatus[] = [
  'sent', 'viewed', 'partially_paid', 'overdue',
];

export const LEAD_STATUSES: StatusMeta<LeadStatus>[] = [
  { value: 'new', label: 'New', tone: 'info' },
  { value: 'contacted', label: 'Contacted', tone: 'progress' },
  { value: 'qualified', label: 'Qualified', tone: 'progress' },
  { value: 'quoted', label: 'Quoted', tone: 'info' },
  { value: 'won', label: 'Won', tone: 'success' },
  { value: 'lost', label: 'Lost', tone: 'danger' },
];

export const TASK_STATUSES: StatusMeta<TaskStatus>[] = [
  { value: 'open', label: 'Open', tone: 'neutral' },
  { value: 'in_progress', label: 'In progress', tone: 'progress' },
  { value: 'completed', label: 'Completed', tone: 'success' },
  { value: 'verified', label: 'Verified', tone: 'success' },
];

export const TASK_PRIORITIES: StatusMeta<TaskPriority>[] = [
  { value: 'low', label: 'Low', tone: 'neutral' },
  { value: 'medium', label: 'Medium', tone: 'info' },
  { value: 'high', label: 'High', tone: 'warning' },
  { value: 'urgent', label: 'Urgent', tone: 'danger' },
];

export const ESTIMATE_STATUSES: StatusMeta<EstimateStatus>[] = [
  { value: 'draft', label: 'Draft', tone: 'neutral' },
  { value: 'ready', label: 'Ready', tone: 'info' },
  { value: 'converted', label: 'Converted', tone: 'success' },
  { value: 'archived', label: 'Archived', tone: 'neutral' },
];

export const REPORT_STATUSES: StatusMeta<ReportStatus>[] = [
  { value: 'draft', label: 'Draft', tone: 'neutral' },
  { value: 'final', label: 'Final', tone: 'success' },
  { value: 'sent', label: 'Sent', tone: 'info' },
];

export const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'direct_debit', label: 'Direct debit' },
  { value: 'other', label: 'Other' },
] as const;

export const PHOTO_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'before', label: 'Before' },
  { value: 'during', label: 'During' },
  { value: 'after', label: 'After' },
  { value: 'defect', label: 'Defect' },
  { value: 'safety', label: 'Safety' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'damage', label: 'Damage' },
] as const;

export const BUSINESS_TYPES = [
  'Builder', 'Carpenter', 'Bricklayer', 'Concreter', 'Plumber', 'Electrician',
  'Painter', 'Plasterer', 'Roofer', 'Tiler', 'Landscaper', 'Fencing',
  'Civil contractor', 'Excavation', 'Demolition', 'Scaffolding', 'Glazier',
  'Air conditioning', 'Security services', 'Cleaning', 'Maintenance',
  'Building inspector', 'Pest control', 'Locksmith', 'Other trade',
] as const;

export const UNITS = [
  'each', 'hour', 'day', 'week', 'm', 'm²', 'm³', 'lm', 'kg', 'tonne',
  'litre', 'pack', 'lot', 'item',
] as const;

const lookup = <T extends string>(list: StatusMeta<T>[]) => {
  const map = new Map(list.map((entry) => [entry.value, entry]));
  return (value: T | string | null | undefined): StatusMeta<T> =>
    map.get(value as T) ?? { value: (value ?? 'unknown') as T, label: humanise(value), tone: 'neutral' };
};

export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export const jobStatus = lookup(JOB_STATUSES);
export const quoteStatus = lookup(QUOTE_STATUSES);
export const invoiceStatus = lookup(INVOICE_STATUSES);
export const leadStatus = lookup(LEAD_STATUSES);
export const taskStatus = lookup(TASK_STATUSES);
export const taskPriority = lookup(TASK_PRIORITIES);
export const estimateStatus = lookup(ESTIMATE_STATUSES);
export const reportStatus = lookup(REPORT_STATUSES);

/**
 * Job statuses reachable from a given one. The board only offers moves that
 * make sense, but nothing is a dead end: any job can be put on hold or
 * cancelled, and a cancelled job can be reopened.
 */
export function nextJobStatuses(current: JobStatus): JobStatus[] {
  const flow: Record<JobStatus, JobStatus[]> = {
    lead: ['estimating', 'quote_sent', 'cancelled'],
    estimating: ['quote_sent', 'accepted', 'cancelled'],
    quote_sent: ['accepted', 'estimating', 'cancelled'],
    accepted: ['scheduled', 'in_progress', 'on_hold', 'cancelled'],
    scheduled: ['in_progress', 'on_hold', 'cancelled'],
    in_progress: ['completed', 'on_hold', 'cancelled'],
    on_hold: ['in_progress', 'scheduled', 'cancelled'],
    completed: ['invoiced', 'in_progress'],
    invoiced: ['paid', 'completed'],
    paid: ['invoiced'],
    cancelled: ['lead'],
  };
  return flow[current] ?? [];
}

export const NOTIFICATION_KINDS = {
  quote_accepted: 'Quote accepted',
  quote_declined: 'Quote declined',
  quote_changes_requested: 'Changes requested on a quote',
  invoice_overdue: 'Invoice overdue',
  invoice_paid: 'Invoice paid',
  email_received: 'New email',
  task_created: 'New task',
  task_due: 'Task due',
  report_requested: 'Report requested',
  customer_message: 'Customer message',
  job_deadline: 'Job deadline approaching',
} as const;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;
