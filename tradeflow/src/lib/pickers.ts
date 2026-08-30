import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * The option lists forms need: customers, jobs, team members, suppliers.
 *
 * Each is capped rather than unbounded — a picker with three thousand entries
 * is not usable anyway, and the cap keeps a form page to one small query per
 * list. The cap is generous enough that a real trade business never reaches it;
 * the search on the corresponding index page is the answer if one ever does.
 */

const LIMIT = 500;

export interface CustomerOption {
  id: string;
  name: string;
  company: string | null;
  address_line1: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
}

export async function customerOptions(businessId: string): Promise<CustomerOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('customers')
    .select('id, name, company, address_line1, suburb, state, postcode')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('name')
    .limit(LIMIT);
  return (data ?? []) as CustomerOption[];
}

export interface JobOption {
  id: string;
  number: string;
  name: string;
  status: string;
  customer_id: string | null;
  site_address_line1: string | null;
  site_suburb: string | null;
}

export async function jobOptions(businessId: string): Promise<JobOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('jobs')
    .select('id, number, name, status, customer_id, site_address_line1, site_suburb')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  return (data ?? []) as JobOption[];
}

export interface TeamOption {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

export async function teamOptions(businessId: string): Promise<TeamOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('team_members')
    .select('id, full_name, email, role')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('full_name', { nullsFirst: false })
    .limit(LIMIT);
  return (data ?? []) as TeamOption[];
}

export async function supplierOptions(
  businessId: string
): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('name')
    .limit(LIMIT);
  return data ?? [];
}

export async function materialOptions(businessId: string): Promise<
  { id: string; name: string; unit: string; unit_cost_cents: number; unit_price_cents: number }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('materials')
    .select('id, name, unit, unit_cost_cents, unit_price_cents')
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .order('name')
    .limit(LIMIT);
  return data ?? [];
}

/** "JOB-0042 — Front elevation rebuild", for a picker or a PDF reference. */
export function jobLabel(job: { number: string; name: string } | null | undefined): string {
  return job ? `${job.number} — ${job.name}` : '';
}

export function customerLabel(
  customer: { name: string; company: string | null } | null | undefined
): string {
  if (!customer) return '';
  return customer.company ? `${customer.company} — ${customer.name}` : customer.name;
}
