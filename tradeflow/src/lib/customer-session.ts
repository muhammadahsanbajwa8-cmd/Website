import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSession, type Session } from '@/lib/session';
import type { Json } from '@/lib/database.types';

/**
 * The customer's side of the door.
 *
 * A customer is not staff: they hold no role, belong to no team, and reach
 * nothing through the application shell. What they have is a link — one row in
 * `customer_users` — joining their login to one customer record at one
 * business. A person can hold several (a landlord who uses two trades), which
 * is why this looks a little like the business session: a list of links, and
 * one of them active.
 *
 * Everything here is read through `portal_links()`, a definer function that
 * returns the fields a customer is entitled to see. Deliberately not a table
 * read: `customers` and `jobs` both carry a `notes` column that belongs to the
 * business, and a row level policy cannot hide a column.
 */

export const ACTIVE_PORTAL_COOKIE = 'tf_portal';

export interface PortalLink {
  linkId: string;
  customerId: string;
  businessId: string;
  customerName: string;
  customerCompany: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerAddressLine1: string | null;
  customerAddressLine2: string | null;
  customerSuburb: string | null;
  customerState: string | null;
  customerPostcode: string | null;
  businessName: string;
  businessEmail: string | null;
  businessPhone: string | null;
  businessAbn: string | null;
  businessLogoPath: string | null;
  businessSuburb: string | null;
  businessState: string | null;
  acceptsCards: boolean;
}

export interface CustomerSession extends Session {
  /** Every business this person is a customer of. */
  links: PortalLink[];
  /** The one they are looking at now. */
  link: PortalLink;
}

interface RawLink {
  link_id: string;
  customer_id: string;
  business_id: string;
  customer_name: string;
  customer_company: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address_line1: string | null;
  customer_address_line2: string | null;
  customer_suburb: string | null;
  customer_state: string | null;
  customer_postcode: string | null;
  business_name: string;
  business_email: string | null;
  business_phone: string | null;
  business_abn: string | null;
  business_logo_path: string | null;
  business_suburb: string | null;
  business_state: string | null;
  accepts_cards: boolean | null;
}

function toLink(raw: RawLink): PortalLink {
  return {
    linkId: raw.link_id,
    customerId: raw.customer_id,
    businessId: raw.business_id,
    customerName: raw.customer_name,
    customerCompany: raw.customer_company,
    customerEmail: raw.customer_email,
    customerPhone: raw.customer_phone,
    customerAddressLine1: raw.customer_address_line1,
    customerAddressLine2: raw.customer_address_line2,
    customerSuburb: raw.customer_suburb,
    customerState: raw.customer_state,
    customerPostcode: raw.customer_postcode,
    businessName: raw.business_name,
    businessEmail: raw.business_email,
    businessPhone: raw.business_phone,
    businessAbn: raw.business_abn,
    businessLogoPath: raw.business_logo_path,
    businessSuburb: raw.business_suburb,
    businessState: raw.business_state,
    acceptsCards: raw.accepts_cards === true,
  };
}

/** Every portal link this signed-in person holds. Empty for staff-only users. */
export const getPortalLinks = cache(async (): Promise<PortalLink[]> => {
  const session = await getSession();
  if (!session) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc('portal_links');
  const raw = (data ?? []) as unknown as RawLink[];
  return Array.isArray(raw) ? raw.map(toLink) : [];
});

/** True when this user has a customer account somewhere. */
export async function isCustomer(): Promise<boolean> {
  return (await getPortalLinks()).length > 0;
}

/**
 * The portal session, with the active link resolved.
 *
 * The cookie is a preference, not a permission: a hand-edited value naming
 * somebody else's link simply falls back to the first one this person holds.
 */
export const getCustomerSession = cache(async (): Promise<CustomerSession | null> => {
  const session = await getSession();
  if (!session) return null;

  const links = await getPortalLinks();
  if (links.length === 0) return null;

  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_PORTAL_COOKIE)?.value;
  const link = links.find((l) => l.linkId === requested) ?? links[0]!;

  return { ...session, links, link };
});

export async function requireCustomer(): Promise<CustomerSession> {
  const session = await getSession();
  if (!session) redirect('/login');
  const portal = await getCustomerSession();
  if (!portal) redirect('/dashboard');
  return portal;
}

/**
 * Where a signed-in person belongs.
 *
 * Staff go to the dashboard, customers to the portal, and someone who is
 * neither is sent to create a business. Used after sign-in and by the two
 * shells, so nobody lands on a page that immediately bounces them.
 */
export async function landingPath(): Promise<string> {
  const session = await getSession();
  if (!session) return '/login';
  if (session.memberships.length > 0) return '/dashboard';
  return (await getPortalLinks()).length > 0 ? '/portal' : '/onboarding';
}

/** A parsed `portal_*` payload, or the fallback when the call returned null. */
export function payload<T>(data: Json | null, fallback: T): T {
  return (data as unknown as T | null) ?? fallback;
}
