import type { Tone } from '@/lib/domain';

/**
 * The customer's vocabulary.
 *
 * The office says "quote_sent", "partially_paid", "qualified". A customer says
 * "we've sent you a price", "part paid", "we're looking at it". Same rows, and
 * the business keeps its own words on its own screens — this is only what is
 * printed in the portal, and it exists so nobody has to learn a pipeline to
 * find out when someone is turning up.
 */

export interface PortalJob {
  id: string;
  number: string;
  name: string;
  description: string | null;
  status: string;
  start_date: string | null;
  expected_completion_date: string | null;
  completed_at: string | null;
  site_address_line1: string | null;
  site_suburb: string | null;
  site_state: string | null;
  site_postcode: string | null;
  created_at: string;
}

export interface PortalJobDetail extends PortalJob {
  business_id: string;
  customer_id: string;
  assigned: string[];
}

export interface PortalRequest {
  id: string;
  description: string | null;
  status: string;
  site_address: string | null;
  preferred_date: string | null;
  preferred_window: string | null;
  service_name: string | null;
  created_at: string;
  job_id: string | null;
}

export interface PortalSummary {
  open_requests: number;
  active_jobs: number;
  completed_jobs: number;
  next_visit: { id: string; number: string; name: string; start_date: string; status: string } | null;
  amount_due_cents: number;
  overdue_cents: number;
  paid_cents: number;
  reports: number;
  open_quotes: number;
  unread_messages: number;
}

interface Said {
  label: string;
  tone: Tone;
  /** One line under the label, where a customer would otherwise have to ask. */
  note?: string;
}

const JOB: Record<string, Said> = {
  lead: { label: 'Being looked at', tone: 'neutral', note: 'We have your enquiry.' },
  estimating: { label: 'Being priced', tone: 'info', note: 'Working out what it will cost.' },
  quote_sent: { label: 'Price sent', tone: 'info', note: 'Waiting on your go-ahead.' },
  accepted: { label: 'Accepted', tone: 'success', note: 'Booked in — a date is coming.' },
  scheduled: { label: 'Booked in', tone: 'progress' },
  in_progress: { label: 'Under way', tone: 'progress' },
  on_hold: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Finished', tone: 'success' },
  invoiced: { label: 'Finished — invoice sent', tone: 'info' },
  paid: { label: 'Finished and paid', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
};

const REQUEST: Record<string, Said> = {
  new: { label: 'Sent', tone: 'info', note: 'We have it and will come back to you.' },
  contacted: { label: 'In touch', tone: 'progress' },
  qualified: { label: 'Being looked at', tone: 'progress' },
  quoted: { label: 'Price sent', tone: 'info', note: 'Have a look under Documents.' },
  won: { label: 'Booked in', tone: 'success' },
  lost: { label: 'Closed', tone: 'neutral' },
};

const BILL: Record<string, Said> = {
  draft: { label: 'Not sent', tone: 'neutral' },
  sent: { label: 'Due', tone: 'warning' },
  viewed: { label: 'Due', tone: 'warning' },
  partially_paid: { label: 'Part paid', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  overdue: { label: 'Overdue', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const QUOTE: Record<string, Said> = {
  draft: { label: 'Not sent', tone: 'neutral' },
  sent: { label: 'Waiting on you', tone: 'warning' },
  viewed: { label: 'Waiting on you', tone: 'warning' },
  accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'neutral' },
  changes_requested: { label: 'Changes asked for', tone: 'info' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const fallback = (value: string | null | undefined): Said => ({
  label: (value ?? 'Unknown').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
  tone: 'neutral',
});

export const bookingWord = (status: string | null | undefined): Said =>
  JOB[status ?? ''] ?? fallback(status);
export const requestWord = (status: string | null | undefined): Said =>
  REQUEST[status ?? ''] ?? fallback(status);
export const billWord = (status: string | null | undefined): Said =>
  BILL[status ?? ''] ?? fallback(status);
export const quoteWord = (status: string | null | undefined): Said =>
  QUOTE[status ?? ''] ?? fallback(status);

/** The site address of a job, on one line. */
export function siteLine(job: {
  site_address_line1: string | null;
  site_suburb: string | null;
  site_state: string | null;
  site_postcode: string | null;
}): string {
  return [job.site_address_line1, job.site_suburb, job.site_state, job.site_postcode]
    .filter(Boolean)
    .join(', ');
}

/** A booking that has not happened yet. */
export function isUpcoming(job: PortalJob): boolean {
  return ['accepted', 'scheduled', 'in_progress', 'on_hold', 'quote_sent', 'estimating', 'lead'].includes(
    job.status
  );
}
