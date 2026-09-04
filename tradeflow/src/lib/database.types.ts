/**
 * Database types.
 *
 * Row shapes are written by hand rather than generated, so the repository
 * type-checks without a live Supabase project. They mirror
 * supabase/migrations/0001_schema.sql; tests/schema.test.ts reads the SQL and
 * fails if a column exists in one and not the other.
 *
 * `Insert` and `Update` are partials of the row. Excess-property checking on
 * object literals still catches a mistyped column name, which is the mistake
 * worth catching at compile time; a missing NOT NULL column is caught by the
 * database itself, which is where that rule actually lives.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type TeamRole = 'owner' | 'admin' | 'manager' | 'worker' | 'accountant';
export type JobStatus =
  | 'lead' | 'estimating' | 'quote_sent' | 'accepted' | 'scheduled'
  | 'in_progress' | 'on_hold' | 'completed' | 'invoiced' | 'paid' | 'cancelled';
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
export type EstimateStatus = 'draft' | 'ready' | 'converted' | 'archived';
export type QuoteStatus =
  | 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined'
  | 'changes_requested' | 'expired' | 'cancelled';
export type InvoiceStatus =
  | 'draft' | 'sent' | 'viewed' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled';
export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'verified';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type CostKind = 'labour' | 'materials' | 'equipment' | 'travel' | 'subcontractor' | 'other';
export type ReportStatus = 'draft' | 'final' | 'sent';
export type EmailDirection = 'inbound' | 'outbound';
export type EmailState = 'draft' | 'queued' | 'sent' | 'failed' | 'received';
export type MailboxProvider = 'google' | 'microsoft' | 'imap';
export type PaymentStatus =
  | 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'refunded' | 'partially_refunded';
export type PaymentProvider = 'manual' | 'stripe';
export type PaymentMethod = 'bank_transfer' | 'card' | 'cash' | 'cheque' | 'direct_debit' | 'other';
export type PhotoCategory =
  | 'general' | 'before' | 'during' | 'after' | 'defect' | 'safety' | 'compliance' | 'damage';

type Timestamps = {
  created_at: string;
  updated_at: string;
}
type SoftDelete = {
  deleted_at: string | null;
}

export type Business = Timestamps & SoftDelete & {
  id: string;
  name: string;
  business_type: string | null;
  abn: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string;
  logo_path: string | null;
  gst_registered: boolean;
  default_payment_terms_days: number;
  quote_validity_days: number;
  default_markup_bp: number;
  bank_account_name: string | null;
  bank_bsb: string | null;
  bank_account_number: string | null;
  /** The business's standing policies, copied onto each new document. */
  default_quote_terms: string | null;
  default_invoice_terms: string | null;
  default_payment_terms: string | null;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_details_submitted: boolean;
  stripe_connected_at: string | null;
  platform_fee_bp: number;
  plan: string;
  is_demo: boolean;
  onboarded_at: string | null;
}

export type Profile = Timestamps & {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_path: string | null;
}

export type TeamMember = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  user_id: string | null;
  role: TeamRole;
  full_name: string | null;
  email: string;
  phone: string | null;
  hourly_rate_cents: number | null;
  invite_token: string | null;
  invited_at: string | null;
  accepted_at: string | null;
}

export type NumberSequence = {
  business_id: string;
  kind: string;
  prefix: string;
  next_value: number;
  padding: number;
}

export type Customer = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  abn: string | null;
  contact_person: string | null;
  address_line1: string | null;
  address_line2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string;
  notes: string | null;
  created_by: string | null;
}

export type Contact = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  customer_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
}

export type Lead = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  customer_id: string | null;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  description: string | null;
  status: LeadStatus;
  estimated_value_cents: number | null;
  site_address: string | null;
  next_follow_up_at: string | null;
  lost_reason: string | null;
  created_by: string | null;
  /** Set when the request came from the customer portal. */
  service_id: string | null;
  preferred_date: string | null;
  preferred_window: string | null;
}

export type Supplier = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  account_number: string | null;
  notes: string | null;
}

export type Material = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  supplier_id: string | null;
  sku: string | null;
  name: string;
  description: string | null;
  unit: string;
  unit_cost_cents: number;
  unit_price_cents: number;
  taxable: boolean;
}

export type Job = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  customer_id: string | null;
  lead_id: string | null;
  number: string;
  name: string;
  description: string | null;
  site_address_line1: string | null;
  site_suburb: string | null;
  site_state: string | null;
  site_postcode: string | null;
  status: JobStatus;
  start_date: string | null;
  expected_completion_date: string | null;
  completed_at: string | null;
  budget_cents: number | null;
  notes: string | null;
  created_by: string | null;
}

export type JobAssignment = {
  id: string;
  business_id: string;
  job_id: string;
  team_member_id: string;
  created_at: string;
}

export type JobTask = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  job_id: string | null;
  customer_id: string | null;
  email_id: string | null;
  report_id: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assigned_to: string | null;
  due_date: string | null;
  completed_at: string | null;
  verified_at: string | null;
  verified_by: string | null;
  source: 'manual' | 'email' | 'report' | 'defect' | 'customer_request' | 'ai';
  created_by: string | null;
}

export type JobNote = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  job_id: string;
  body: string;
  created_by: string | null;
}

export type Estimate = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  job_id: string | null;
  customer_id: string | null;
  number: string;
  title: string;
  notes: string | null;
  status: EstimateStatus;
  markup_bp: number;
  contingency_bp: number;
  gst_bp: number;
  gst_applies: boolean;
  created_by: string | null;
}

export type EstimateItem = Timestamps & {
  id: string;
  business_id: string;
  estimate_id: string;
  kind: CostKind;
  description: string;
  quantity_milli: number;
  unit: string;
  unit_cost_cents: number;
  taxable: boolean;
  position: number;
}

export type Quote = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  estimate_id: string | null;
  job_id: string | null;
  customer_id: string;
  number: string;
  version: number;
  status: QuoteStatus;
  title: string;
  scope_of_work: string | null;
  terms: string | null;
  payment_terms: string | null;
  issue_date: string;
  expiry_date: string | null;
  gst_bp: number;
  gst_applies: boolean;
  discount_cents: number;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  share_token: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  customer_message: string | null;
  accepted_by_name: string | null;
  accepted_ip: string | null;
  created_by: string | null;
}

export type DocumentItem = Timestamps & {
  id: string;
  business_id: string;
  description: string;
  detail: string | null;
  quantity_milli: number;
  unit: string;
  unit_price_cents: number;
  taxable: boolean;
  position: number;
}

export type QuoteItem = DocumentItem & {
  quote_id: string;
}

export type QuoteVersion = {
  id: string;
  business_id: string;
  quote_id: string;
  version: number;
  snapshot: Json;
  total_cents: number;
  created_by: string | null;
  created_at: string;
}

export type Invoice = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  quote_id: string | null;
  job_id: string | null;
  customer_id: string;
  number: string;
  status: InvoiceStatus;
  title: string | null;
  issue_date: string;
  due_date: string | null;
  payment_terms: string | null;
  notes: string | null;
  bank_details: string | null;
  gst_bp: number;
  gst_applies: boolean;
  discount_cents: number;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  share_token: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  paid_at: string | null;
  created_by: string | null;
}

export type InvoiceItem = DocumentItem & {
  invoice_id: string;
}

export type Payment = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  invoice_id: string;
  customer_id: string | null;
  amount_cents: number;
  method: PaymentMethod;
  reference: string | null;
  paid_on: string;
  notes: string | null;
  created_by: string | null;
  provider: PaymentProvider;
  /** Only `succeeded` counts towards an invoice. Set from the provider's own record. */
  status: PaymentStatus;
  provider_payment_id: string | null;
  provider_fee_cents: number;
  platform_fee_cents: number;
  refunded_cents: number;
  receipt_url: string | null;
  failure_reason: string | null;
  paid_at: string | null;
}

export type Expense = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  job_id: string | null;
  supplier_id: string | null;
  category: CostKind;
  description: string;
  amount_cents: number;
  gst_cents: number;
  spent_on: string;
  reference: string | null;
  receipt_path: string | null;
  billable: boolean;
  notes: string | null;
  created_by: string | null;
}

export type WorkLog = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  job_id: string;
  work_date: string;
  start_time: string | null;
  finish_time: string | null;
  break_minutes: number;
  total_minutes: number;
  worker_count: number;
  work_completed: string | null;
  materials_used: string | null;
  equipment_used: string | null;
  weather: string | null;
  problems: string | null;
  notes: string | null;
  created_by: string | null;
}

export type WorkLogWorker = {
  id: string;
  business_id: string;
  work_log_id: string;
  team_member_id: string | null;
  name: string;
  minutes: number;
  created_at: string;
}

export type ReportTemplate = Timestamps & SoftDelete & {
  id: string;
  business_id: string | null;
  key: string;
  name: string;
  description: string | null;
  sections: Json;
  is_system: boolean;
}

export type Report = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  template_id: string | null;
  template_key: string;
  job_id: string | null;
  customer_id: string | null;
  number: string;
  title: string;
  report_date: string;
  status: ReportStatus;
  data: Record<string, Json>;
  summary: string | null;
  signature_name: string | null;
  signature_path: string | null;
  signed_at: string | null;
  sent_at: string | null;
  created_by: string | null;
  /** Minted when first sent. The customer opens /r/<token> with no account. */
  share_token: string | null;
  sent_to: string | null;
  send_error: string | null;
  send_count: number;
  viewed_at: string | null;
  completed_at: string | null;
}

export type JobPhoto = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  job_id: string | null;
  report_id: string | null;
  work_log_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  caption: string | null;
  category: PhotoCategory;
  taken_at: string;
  created_by: string | null;
}

export type ReportPhoto = {
  id: string;
  business_id: string;
  report_id: string;
  photo_id: string;
  position: number;
  caption: string | null;
  created_at: string;
}

export type JobDocument = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  job_id: string | null;
  customer_id: string | null;
  quote_id: string | null;
  invoice_id: string | null;
  report_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  category: string;
  description: string | null;
  created_by: string | null;
}

export type EmailAccount = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  user_id: string | null;
  provider: MailboxProvider;
  email_address: string;
  display_name: string | null;
  token_expires_at: string | null;
  scopes: string[] | null;
  history_cursor: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
  is_active: boolean;
}

/**
 * The same row, with the sealed tokens.
 *
 * `authenticated` has SELECT and UPDATE revoked on these two columns in
 * migration 0003, so through PostgREST they come back undefined for everyone —
 * only the service role sees a value, and only `lib/email/oauth.ts` and
 * `lib/email/sync.ts` read them. They are typed `| null` for that reason:
 * anything reading them must cope with getting nothing.
 *
 * `EmailAccount` is the type the rest of the application uses, and it has no
 * mention of a token on it.
 */
export type EmailAccountRow = EmailAccount & {
  refresh_token_enc: string | null;
  access_token_enc: string | null;
};

export type EmailThread = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  email_account_id: string | null;
  provider_thread_id: string | null;
  subject: string | null;
  snippet: string | null;
  customer_id: string | null;
  job_id: string | null;
  quote_id: string | null;
  invoice_id: string | null;
  participants: string[];
  message_count: number;
  is_read: boolean;
  last_message_at: string | null;
}

export type Email = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  thread_id: string | null;
  email_account_id: string | null;
  provider_message_id: string | null;
  direction: EmailDirection;
  state: EmailState;
  from_address: string;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  bcc_addresses: string[];
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  snippet: string | null;
  customer_id: string | null;
  job_id: string | null;
  quote_id: string | null;
  invoice_id: string | null;
  report_id: string | null;
  is_read: boolean;
  ai_summary: string | null;
  ai_actions: Json | null;
  error: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_by: string | null;
}

export type EmailAttachment = {
  id: string;
  business_id: string;
  email_id: string;
  document_id: string | null;
  storage_path: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  generated_kind: 'quote' | 'invoice' | 'report' | null;
  generated_id: string | null;
  created_at: string;
}

export type Notification = {
  id: string;
  business_id: string;
  user_id: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  severity: 'info' | 'success' | 'warning' | 'danger';
  read_at: string | null;
  created_at: string;
}

export type Activity = {
  id: string;
  business_id: string;
  actor_id: string | null;
  actor_label: string | null;
  verb: string;
  summary: string;
  entity_type: string;
  entity_id: string | null;
  job_id: string | null;
  customer_id: string | null;
  quote_id: string | null;
  invoice_id: string | null;
  meta: Json | null;
  created_at: string;
}

export type AuditLog = {
  id: number;
  business_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  outcome: 'allowed' | 'denied' | 'error';
  ip_address: string | null;
  user_agent: string | null;
  detail: Json | null;
  created_at: string;
}

// --- the AI business brain and the phone agent (migration 0005) -------------

export type CallDirection = 'inbound' | 'outbound';
export type CallStatus =
  | 'ringing' | 'in_progress' | 'completed' | 'no_answer' | 'failed' | 'voicemail';
export type CallTurnRole = 'caller' | 'agent' | 'system';
export type AiVoiceTone =
  | 'professional' | 'friendly' | 'casual' | 'warm' | 'concise' | 'formal';

export type IndustryProfileRow = Timestamps & {
  id: string;
  business_id: string | null;
  key: string;
  name: string;
  description: string | null;
  terminology: string[];
  common_services: string[];
  common_questions: string[];
  is_system: boolean;
}

export type AiBrain = Timestamps & {
  business_id: string;
  industry_key: string | null;
  tone: AiVoiceTone;
  voice_name: string;
  speaking_rate: number;
  language: string;
  greeting: string | null;
  after_hours_greeting: string | null;
  voicemail_greeting: string | null;
  services: string[];
  service_area: string | null;
  business_hours: Json;
  emergency_hours: string | null;
  staff: Json;
  escalation_name: string | null;
  escalation_phone: string | null;
  escalation_email: string | null;
  allowed_topics: string[];
  forbidden_topics: string[];
  policies: string | null;
  pricing_guidance: string | null;
  disclose_ai: boolean;
  may_discuss_pricing: boolean;
  may_confirm_bookings: boolean;
  may_share_job_status: boolean;
  max_call_minutes: number;
  enabled: boolean;
  phone_number: string | null;
}

export type AiFaq = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  question: string;
  answer: string;
  category: string | null;
  position: number;
}

export type AiKnowledge = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  title: string;
  body: string;
  category: string;
  approved: boolean;
  created_by: string | null;
}

export type Call = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  direction: CallDirection;
  status: CallStatus;
  provider: string;
  provider_call_sid: string | null;
  from_number: string | null;
  to_number: string | null;
  caller_name: string | null;
  customer_id: string | null;
  job_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  summary: string | null;
  intent: string | null;
  sentiment: 'positive' | 'neutral' | 'frustrated' | 'angry' | null;
  outcome: string | null;
  escalated: boolean;
  escalation_reason: string | null;
  after_hours: boolean;
  handled_by_ai: boolean;
}

export type CallTurn = {
  id: string;
  business_id: string;
  call_id: string;
  role: CallTurnRole;
  text: string;
  confidence: number | null;
  latency_ms: number | null;
  interrupted: boolean;
  position: number;
  created_at: string;
}

export type CallAction = Timestamps & {
  id: string;
  business_id: string;
  call_id: string;
  kind: 'task' | 'note' | 'callback' | 'quote_request' | 'complaint' | 'booking';
  title: string;
  detail: string | null;
  priority: TaskPriority;
  due_date: string | null;
  suggested_job_id: string | null;
  suggested_customer_id: string | null;
  applied: boolean;
  applied_at: string | null;
  task_id: string | null;
  dismissed: boolean;
}

export type AiFeedback = {
  id: string;
  business_id: string;
  call_id: string | null;
  turn_id: string | null;
  rating: 'good' | 'needs_improvement';
  misunderstanding: string | null;
  correction: string | null;
  applied_to_brain: boolean;
  knowledge_id: string | null;
  created_by: string | null;
  created_at: string;
}

export type CustomerUser = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  customer_id: string;
  user_id: string | null;
  email: string;
  invite_token: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  last_seen_at: string | null;
}

/** A line on the business's own list of what it will take on. */
export type Service = Timestamps & SoftDelete & {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  price_from_cents: number | null;
  price_note: string | null;
  lead_time: string | null;
  is_active: boolean;
  position: number;
  created_by: string | null;
}

/** One line in the thread between a customer and a business. */
export type Message = {
  id: string;
  business_id: string;
  customer_id: string;
  job_id: string | null;
  sender: 'customer' | 'business';
  author_id: string | null;
  author_label: string | null;
  body: string;
  read_by_business_at: string | null;
  read_by_customer_at: string | null;
  created_at: string;
  deleted_at: string | null;
}

export type PaymentEvent = {
  id: string;
  business_id: string | null;
  provider: string;
  event_id: string;
  event_type: string;
  payload: Json;
  handled: boolean;
  error: string | null;
  created_at: string;
}

type TableRows = {
  industry_profiles: IndustryProfileRow;
  ai_brain: AiBrain;
  ai_faqs: AiFaq;
  ai_knowledge: AiKnowledge;
  calls: Call;
  call_turns: CallTurn;
  call_actions: CallAction;
  ai_feedback: AiFeedback;
  businesses: Business;
  profiles: Profile;
  team_members: TeamMember;
  number_sequences: NumberSequence;
  customers: Customer;
  contacts: Contact;
  leads: Lead;
  suppliers: Supplier;
  materials: Material;
  jobs: Job;
  job_assignments: JobAssignment;
  job_tasks: JobTask;
  job_notes: JobNote;
  estimates: Estimate;
  estimate_items: EstimateItem;
  quotes: Quote;
  quote_items: QuoteItem;
  quote_versions: QuoteVersion;
  invoices: Invoice;
  invoice_items: InvoiceItem;
  payments: Payment;
  expenses: Expense;
  work_logs: WorkLog;
  work_log_workers: WorkLogWorker;
  report_templates: ReportTemplate;
  reports: Report;
  job_photos: JobPhoto;
  report_photos: ReportPhoto;
  job_documents: JobDocument;
  email_accounts: EmailAccountRow;
  email_threads: EmailThread;
  emails: Email;
  email_attachments: EmailAttachment;
  notifications: Notification;
  activities: Activity;
  audit_logs: AuditLog;
  customer_users: CustomerUser;
  payment_events: PaymentEvent;
  services: Service;
  messages: Message;
}

type TableDefinition<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: { [K in keyof TableRows]: TableDefinition<TableRows[K]> };
    Views: Record<never, never>;
    Functions: {
      create_business_with_owner: {
        Args: {
          p_name: string;
          p_business_type?: string | null;
          p_abn?: string | null;
          p_email?: string | null;
          p_phone?: string | null;
          p_address_line1?: string | null;
          p_suburb?: string | null;
          p_state?: string | null;
          p_postcode?: string | null;
          p_gst_registered?: boolean;
          p_payment_terms_days?: number;
        };
        Returns: string;
      };
      accept_team_invite: { Args: { p_token: string }; Returns: string };
      accept_customer_invite: { Args: { p_token: string }; Returns: string };
      public_report_by_token: { Args: { p_token: string }; Returns: Json };
      portal_links: { Args: Record<string, never>; Returns: Json };
      portal_jobs: { Args: { p_business: string }; Returns: Json };
      portal_job: { Args: { p_job: string }; Returns: Json };
      portal_requests: { Args: { p_business: string }; Returns: Json };
      portal_summary: { Args: { p_business: string; p_customer: string }; Returns: Json };
      portal_create_request: {
        Args: {
          p_business: string;
          p_customer: string;
          p_service: string | null;
          p_description: string;
          p_preferred_date: string | null;
          p_preferred_window: string | null;
          p_site_address: string | null;
        };
        Returns: string;
      };
      portal_update_customer: {
        Args: {
          p_customer: string;
          p_email: string | null;
          p_phone: string | null;
          p_address_line1: string | null;
          p_address_line2: string | null;
          p_suburb: string | null;
          p_state: string | null;
          p_postcode: string | null;
        };
        Returns: undefined;
      };
      portal_document_token: { Args: { p_kind: string; p_id: string }; Returns: string | null };
      portal_mark_messages_read: {
        Args: { p_business: string; p_customer: string };
        Returns: undefined;
      };
      public_invoice_payable: { Args: { p_token: string }; Returns: Json };
      next_document_number: { Args: { target: string; doc_kind: string }; Returns: string };
      dashboard_summary: { Args: { target: string }; Returns: Json };
      job_profitability: { Args: { p_job: string }; Returns: Json };
      mark_overdue_invoices: { Args: { target: string }; Returns: number };
      public_quote_by_token: { Args: { p_token: string }; Returns: Json };
      public_invoice_by_token: { Args: { p_token: string }; Returns: Json };
      public_quote_respond: {
        Args: { p_token: string; p_action: string; p_name?: string | null; p_message?: string | null };
        Returns: Json;
      };
      recalc_invoice_payments: { Args: { p_invoice: string }; Returns: undefined };
      recalc_quote_totals: { Args: { p_quote: string }; Returns: undefined };
      recalc_invoice_totals: { Args: { p_invoice: string }; Returns: undefined };
      ensure_ai_brain: { Args: { target: string }; Returns: undefined };
      ai_identify_caller: { Args: { target: string; p_number: string }; Returns: Json };
    };
    Enums: {
      team_role: TeamRole;
      job_status: JobStatus;
      lead_status: LeadStatus;
      estimate_status: EstimateStatus;
      quote_status: QuoteStatus;
      invoice_status: InvoiceStatus;
      task_status: TaskStatus;
      task_priority: TaskPriority;
      cost_kind: CostKind;
      report_status: ReportStatus;
      email_direction: EmailDirection;
      email_state: EmailState;
      mailbox_provider: MailboxProvider;
      payment_method: PaymentMethod;
      call_direction: CallDirection;
      call_status: CallStatus;
      call_turn_role: CallTurnRole;
      ai_voice_tone: AiVoiceTone;
    };
    CompositeTypes: Record<never, never>;
  };
};

export type TableName = keyof TableRows;
export type Row<T extends TableName> = TableRows[T];
