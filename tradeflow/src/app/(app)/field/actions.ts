'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { audit, recordActivity, requireCapability } from '@/lib/session';
import { UploadError, removeFile, uploadFile } from '@/lib/storage';
import { moneyToCents } from '@/lib/money';
import { workedMinutes } from '@/lib/calc';
import { todayInAustralia } from '@/lib/format';
import {
  expenseSchema,
  fieldErrors,
  leadSchema,
  materialSchema,
  supplierSchema,
  workLogSchema,
} from '@/lib/validation';
import { describeError, fail, invalid, ok, type ActionState } from '@/lib/action-state';

/**
 * The field-work actions: leads, timesheets, expenses and the materials
 * catalogue. They are grouped because they share a shape — a small form, a
 * single insert, an activity line — and splitting them into four files of
 * thirty lines each would hide that.
 */

// --- leads ------------------------------------------------------------------

export async function saveLeadAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('leads.edit');
  const id = String(formData.get('id') ?? '').trim() || null;

  const parsed = leadSchema.safeParse({
    name: formData.get('name'),
    company: formData.get('company'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    source: formData.get('source'),
    description: formData.get('description'),
    status: formData.get('status') || 'new',
    estimatedValueCents: moneyToCents(formData.get('estimatedValue') as string),
    siteAddress: formData.get('siteAddress'),
    nextFollowUpAt: formData.get('nextFollowUpAt'),
    customerId: formData.get('customerId') || null,
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const values = {
    business_id: session.business.id,
    name: parsed.data.name,
    company: parsed.data.company ?? null,
    email: parsed.data.email ?? null,
    phone: parsed.data.phone ?? null,
    source: parsed.data.source ?? null,
    description: parsed.data.description ?? null,
    status: parsed.data.status,
    estimated_value_cents: parsed.data.estimatedValueCents || null,
    site_address: parsed.data.siteAddress ?? null,
    next_follow_up_at: parsed.data.nextFollowUpAt ?? null,
    customer_id: parsed.data.customerId ?? null,
    lost_reason: String(formData.get('lostReason') ?? '').trim() || null,
  };

  if (id) {
    const { error } = await supabase
      .from('leads')
      .update(values)
      .eq('id', id)
      .eq('business_id', session.business.id);
    if (error) return fail(describeError(error));
    revalidatePath(`/leads/${id}`);
    revalidatePath('/leads');
    redirect(`/leads/${id}`);
  }

  const { data, error } = await supabase
    .from('leads')
    .insert({ ...values, created_by: session.userId })
    .select('id')
    .single();
  if (error || !data) return fail(describeError(error));

  await recordActivity(session, {
    verb: 'created',
    summary: `Lead added: ${parsed.data.name}`,
    entityType: 'lead',
    entityId: data.id,
  });
  await audit(session.business.id, { action: 'lead.create', entityType: 'lead', entityId: data.id });

  revalidatePath('/leads');
  redirect(`/leads/${data.id}`);
}

/**
 * A won lead becomes a customer and a job in one step, and the lead keeps a
 * pointer to the customer it turned into.
 */
export async function convertLeadAction(formData: FormData): Promise<void> {
  const session = await requireCapability('jobs.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/leads');

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!lead) redirect('/leads');

  let customerId = lead.customer_id;

  if (!customerId) {
    const { data: customer } = await supabase
      .from('customers')
      .insert({
        business_id: session.business.id,
        name: lead.name,
        company: lead.company,
        email: lead.email,
        phone: lead.phone,
        address_line1: lead.site_address,
        notes: lead.description,
        created_by: session.userId,
      })
      .select('id')
      .single();
    customerId = customer?.id ?? null;
  }

  const { data: number } = await supabase.rpc('next_document_number', {
    target: session.business.id,
    doc_kind: 'job',
  });

  const { data: job } = number
    ? await supabase
        .from('jobs')
        .insert({
          business_id: session.business.id,
          customer_id: customerId,
          lead_id: lead.id,
          number,
          name: lead.description?.slice(0, 120) || `Work for ${lead.name}`,
          description: lead.description,
          site_address_line1: lead.site_address,
          status: 'estimating',
          budget_cents: lead.estimated_value_cents,
          created_by: session.userId,
        })
        .select('id')
        .single()
    : { data: null };

  await supabase
    .from('leads')
    .update({ status: 'won', customer_id: customerId })
    .eq('id', id)
    .eq('business_id', session.business.id);

  await recordActivity(session, {
    verb: 'converted',
    summary: `Lead ${lead.name} won — customer and job created`,
    entityType: 'lead',
    entityId: id,
    customerId,
    jobId: job?.id ?? null,
  });
  await audit(session.business.id, {
    action: 'lead.convert',
    entityType: 'lead',
    entityId: id,
    detail: { customerId, jobId: job?.id ?? null },
  });

  revalidatePath('/leads');
  redirect(job ? `/jobs/${job.id}` : customerId ? `/customers/${customerId}` : '/leads');
}

export async function deleteLeadAction(formData: FormData): Promise<void> {
  const session = await requireCapability('leads.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/leads');

  const supabase = await createClient();
  await supabase
    .from('leads')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  revalidatePath('/leads');
  redirect('/leads');
}

// --- work logs --------------------------------------------------------------

export async function saveWorkLogAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('worklogs.edit');
  const id = String(formData.get('id') ?? '').trim() || null;

  const parsed = workLogSchema.safeParse({
    jobId: formData.get('jobId'),
    workDate: formData.get('workDate') || todayInAustralia(),
    startTime: formData.get('startTime'),
    finishTime: formData.get('finishTime'),
    breakMinutes: formData.get('breakMinutes') || 0,
    workerCount: formData.get('workerCount') || 1,
    workCompleted: formData.get('workCompleted'),
    materialsUsed: formData.get('materialsUsed'),
    equipmentUsed: formData.get('equipmentUsed'),
    weather: formData.get('weather'),
    problems: formData.get('problems'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const values = {
    business_id: session.business.id,
    job_id: parsed.data.jobId,
    work_date: parsed.data.workDate,
    start_time: parsed.data.startTime ?? null,
    finish_time: parsed.data.finishTime ?? null,
    break_minutes: parsed.data.breakMinutes,
    worker_count: parsed.data.workerCount,
    work_completed: parsed.data.workCompleted ?? null,
    materials_used: parsed.data.materialsUsed ?? null,
    equipment_used: parsed.data.equipmentUsed ?? null,
    weather: parsed.data.weather ?? null,
    problems: parsed.data.problems ?? null,
    notes: parsed.data.notes ?? null,
  };

  // The database trigger computes total_minutes; this is the same sum, for the
  // activity line, without a second read.
  const minutes = workedMinutes(
    parsed.data.startTime,
    parsed.data.finishTime,
    parsed.data.breakMinutes
  );

  let logId = id;
  if (id) {
    const { error } = await supabase
      .from('work_logs')
      .update(values)
      .eq('id', id)
      .eq('business_id', session.business.id);
    if (error) return fail(describeError(error));
  } else {
    const { data, error } = await supabase
      .from('work_logs')
      .insert({ ...values, created_by: session.userId })
      .select('id')
      .single();
    if (error || !data) return fail(describeError(error));
    logId = data.id;

    await recordActivity(session, {
      verb: 'logged',
      summary: `${Math.floor(minutes / 60)}h ${minutes % 60}m logged on ${parsed.data.workDate}`,
      entityType: 'work_log',
      entityId: data.id,
      jobId: parsed.data.jobId,
    });
  }

  await audit(session.business.id, {
    action: id ? 'worklog.update' : 'worklog.create',
    entityType: 'work_log',
    entityId: logId,
  });

  revalidatePath('/timesheets');
  revalidatePath(`/jobs/${parsed.data.jobId}`);
  redirect(`/timesheets/${logId}`);
}

export async function deleteWorkLogAction(formData: FormData): Promise<void> {
  const session = await requireCapability('worklogs.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/timesheets');

  const supabase = await createClient();
  await supabase
    .from('work_logs')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  revalidatePath('/timesheets');
  redirect('/timesheets');
}

// --- expenses ---------------------------------------------------------------

export async function saveExpenseAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('expenses.create');
  const id = String(formData.get('id') ?? '').trim() || null;

  const parsed = expenseSchema.safeParse({
    description: formData.get('description'),
    category: formData.get('category') || 'materials',
    amountCents: moneyToCents(formData.get('amount') as string),
    gstCents: moneyToCents(formData.get('gst') as string),
    spentOn: formData.get('spentOn') || todayInAustralia(),
    jobId: formData.get('jobId') || null,
    supplierId: formData.get('supplierId') || null,
    reference: formData.get('reference'),
    billable: formData.get('billable') === 'on',
    notes: formData.get('notes'),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();

  // The receipt is optional, and a failed upload should not lose the expense —
  // the amount is the thing that matters for the books.
  let receiptPath: string | null = null;
  let uploadProblem: string | null = null;
  const receipt = formData.get('receipt');
  if (receipt instanceof File && receipt.size > 0) {
    try {
      const stored = await uploadFile('receipts', session.business.id, 'receipt', receipt);
      receiptPath = stored.path;
    } catch (error) {
      uploadProblem =
        error instanceof UploadError ? error.message : 'The receipt could not be uploaded.';
    }
  }

  const values = {
    business_id: session.business.id,
    description: parsed.data.description,
    category: parsed.data.category,
    amount_cents: parsed.data.amountCents,
    gst_cents: parsed.data.gstCents,
    spent_on: parsed.data.spentOn,
    job_id: parsed.data.jobId ?? null,
    supplier_id: parsed.data.supplierId ?? null,
    reference: parsed.data.reference ?? null,
    billable: parsed.data.billable,
    notes: parsed.data.notes ?? null,
    ...(receiptPath ? { receipt_path: receiptPath } : {}),
  };

  let expenseId = id;
  if (id) {
    const { error } = await supabase
      .from('expenses')
      .update(values)
      .eq('id', id)
      .eq('business_id', session.business.id);
    if (error) {
      if (receiptPath) await removeFile('receipts', receiptPath);
      return fail(describeError(error));
    }
  } else {
    const { data, error } = await supabase
      .from('expenses')
      .insert({ ...values, created_by: session.userId })
      .select('id')
      .single();
    if (error || !data) {
      if (receiptPath) await removeFile('receipts', receiptPath);
      return fail(describeError(error));
    }
    expenseId = data.id;

    if (parsed.data.jobId) {
      await recordActivity(session, {
        verb: 'expense',
        summary: `Expense recorded: ${parsed.data.description}`,
        entityType: 'expense',
        entityId: data.id,
        jobId: parsed.data.jobId,
      });
    }
  }

  await audit(session.business.id, {
    action: id ? 'expense.update' : 'expense.create',
    entityType: 'expense',
    entityId: expenseId,
  });

  revalidatePath('/expenses');
  if (parsed.data.jobId) revalidatePath(`/jobs/${parsed.data.jobId}`);

  if (uploadProblem) {
    return {
      ok: true,
      message: `Expense saved, but the receipt did not upload: ${uploadProblem}`,
      data: { id: expenseId },
    };
  }
  redirect('/expenses');
}

export async function deleteExpenseAction(formData: FormData): Promise<void> {
  const session = await requireCapability('expenses.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/expenses');

  const supabase = await createClient();
  await supabase
    .from('expenses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  revalidatePath('/expenses');
  redirect('/expenses');
}

// --- catalogue --------------------------------------------------------------

export async function saveMaterialAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('materials.edit');
  const id = String(formData.get('id') ?? '').trim() || null;

  const parsed = materialSchema.safeParse({
    name: formData.get('name'),
    sku: formData.get('sku'),
    description: formData.get('description'),
    unit: formData.get('unit') || 'each',
    unitCostCents: moneyToCents(formData.get('unitCost') as string),
    unitPriceCents: moneyToCents(formData.get('unitPrice') as string),
    supplierId: formData.get('supplierId') || null,
    taxable: formData.get('taxable') === 'on',
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const values = {
    business_id: session.business.id,
    name: parsed.data.name,
    sku: parsed.data.sku ?? null,
    description: parsed.data.description ?? null,
    unit: parsed.data.unit,
    unit_cost_cents: parsed.data.unitCostCents,
    unit_price_cents: parsed.data.unitPriceCents,
    supplier_id: parsed.data.supplierId ?? null,
    taxable: parsed.data.taxable,
  };

  const { error } = id
    ? await supabase
        .from('materials')
        .update(values)
        .eq('id', id)
        .eq('business_id', session.business.id)
    : await supabase.from('materials').insert(values);

  if (error) return fail(describeError(error));

  revalidatePath('/materials');
  return ok(id ? 'Material updated.' : `${parsed.data.name} added.`);
}

export async function saveSupplierAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('suppliers.edit');
  const id = String(formData.get('id') ?? '').trim() || null;

  const parsed = supplierSchema.safeParse({
    name: formData.get('name'),
    contactPerson: formData.get('contactPerson'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    address: formData.get('address'),
    accountNumber: formData.get('accountNumber'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  const supabase = await createClient();
  const values = {
    business_id: session.business.id,
    name: parsed.data.name,
    contact_person: parsed.data.contactPerson ?? null,
    email: parsed.data.email ?? null,
    phone: parsed.data.phone ?? null,
    address: parsed.data.address ?? null,
    account_number: parsed.data.accountNumber ?? null,
    notes: parsed.data.notes ?? null,
  };

  const { error } = id
    ? await supabase
        .from('suppliers')
        .update(values)
        .eq('id', id)
        .eq('business_id', session.business.id)
    : await supabase.from('suppliers').insert(values);

  if (error) return fail(describeError(error));

  revalidatePath('/materials');
  return ok(id ? 'Supplier updated.' : `${parsed.data.name} added.`);
}

export async function deleteCatalogueRowAction(formData: FormData): Promise<void> {
  const session = await requireCapability('materials.edit');
  const id = String(formData.get('id') ?? '');
  const table = String(formData.get('table') ?? '');
  if (!id || (table !== 'materials' && table !== 'suppliers')) return;

  const supabase = await createClient();
  await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  revalidatePath('/materials');
}

// --- documents --------------------------------------------------------------

export async function uploadDocumentsAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireCapability('documents.edit');

  const files = formData
    .getAll('documents')
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return fail('Choose at least one file.');
  if (files.length > 20) return fail('Twenty files at a time is the limit.');

  const supabase = await createClient();
  const links = {
    job_id: (String(formData.get('jobId') ?? '') || null) as string | null,
    customer_id: (String(formData.get('customerId') ?? '') || null) as string | null,
  };
  const category = String(formData.get('category') ?? 'general').slice(0, 60);
  const description = String(formData.get('description') ?? '').trim() || null;

  const problems: string[] = [];
  let uploaded = 0;

  for (const file of files) {
    try {
      const stored = await uploadFile('documents', session.business.id, 'doc', file);
      const { error } = await supabase.from('job_documents').insert({
        business_id: session.business.id,
        ...links,
        storage_path: stored.path,
        file_name: file.name.slice(0, 200),
        mime_type: stored.mime,
        size_bytes: stored.size,
        category,
        description,
        created_by: session.userId,
      });
      if (error) {
        await removeFile('documents', stored.path);
        problems.push(`${file.name}: ${describeError(error)}`);
        continue;
      }
      uploaded += 1;
    } catch (error) {
      problems.push(
        error instanceof UploadError ? error.message : `${file.name} could not be uploaded.`
      );
    }
  }

  if (uploaded > 0) {
    await audit(session.business.id, {
      action: 'document.upload',
      entityType: 'job_document',
      detail: { count: uploaded },
    });
    revalidatePath('/documents');
    if (links.job_id) revalidatePath(`/jobs/${links.job_id}`);
    if (links.customer_id) revalidatePath(`/customers/${links.customer_id}`);
  }

  if (uploaded === 0) return fail(problems.join(' ') || 'Nothing was uploaded.');
  if (problems.length > 0) {
    return { ok: true, message: `${uploaded} uploaded. ${problems.join(' ')}` };
  }
  return ok(`${uploaded} file${uploaded === 1 ? '' : 's'} uploaded.`);
}

export async function deleteDocumentAction(formData: FormData): Promise<void> {
  const session = await requireCapability('documents.edit');
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  const { data: document } = await supabase
    .from('job_documents')
    .select('storage_path')
    .eq('id', id)
    .eq('business_id', session.business.id)
    .maybeSingle();

  await supabase
    .from('job_documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', session.business.id);

  if (document?.storage_path) await removeFile('documents', document.storage_path);

  await audit(session.business.id, {
    action: 'document.delete',
    entityType: 'job_document',
    entityId: id,
  });
  revalidatePath('/documents');
}
