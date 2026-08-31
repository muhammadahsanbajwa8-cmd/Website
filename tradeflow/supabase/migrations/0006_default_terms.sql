-- ===========================================================================
-- 0006_default_terms.sql — a business's own policies, written once
--
-- Quotes and invoices already carry `terms` and `payment_terms`, and both are
-- printed at the end of the PDF and on the customer's copy. What was missing
-- was the default: without it every quote starts from generic wording that
-- someone has to remember to replace, and in practice nobody does.
--
-- These columns hold the business's standing policies. A new quote or invoice
-- starts from them; changing them here does not rewrite a document already
-- sent, because what a customer agreed to must not change after the fact.
-- ===========================================================================

alter table businesses
  add column if not exists default_quote_terms text,
  add column if not exists default_invoice_terms text,
  add column if not exists default_payment_terms text;

comment on column businesses.default_quote_terms is
  'Standing terms and conditions printed at the end of every new quote.';
comment on column businesses.default_invoice_terms is
  'Standing terms printed at the end of every new invoice.';
comment on column businesses.default_payment_terms is
  'How and when the business expects to be paid. Shown above the terms.';

-- Sensible Australian defaults for a business that has not written its own,
-- so a first quote is not blank where the terms should be. Only applied where
-- the column is still null: this never overwrites what someone has written.
update businesses
   set default_payment_terms = coalesce(
         default_payment_terms,
         'Payment within ' || default_payment_terms_days || ' days of the invoice date.'
       ),
       default_quote_terms = coalesce(
         default_quote_terms,
         'Prices are in Australian dollars and include GST where shown. This quote holds '
         || 'for the validity period above. Variations to the scope are quoted separately in '
         || 'writing and approved before that work starts. Access to the site and a power '
         || 'and water supply are to be provided. Work not listed above is not included.'
       ),
       default_invoice_terms = coalesce(
         default_invoice_terms,
         'Please quote the invoice number with your payment. Goods remain the property of '
         || 'the supplier until paid in full.'
       )
 where deleted_at is null;

-- The self-check from 0003, run again: adding columns must not have left any
-- table reachable without a policy.
do $$
declare offenders text;
begin
  select string_agg(c.relname, ', ')
    into offenders
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relname <> 'schema_migrations'
     and (not c.relrowsecurity or not exists (select 1 from pg_policy p where p.polrelid = c.oid));

  if offenders is not null then
    raise exception 'tables without row level security or without any policy: %', offenders;
  end if;
end $$;
