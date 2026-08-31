import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { addDays, todayInAustralia } from '@/lib/format';
import type { BusinessSession } from '@/lib/session';

/**
 * Demo data.
 *
 * A worked example of a real business — a bricklayer with jobs at every stage,
 * a quote that has been accepted, an invoice part paid, another overdue, site
 * reports with a defect on one, timesheets, receipts and a filled-in AI brain.
 * Enough that every screen has something on it and the numbers add up.
 *
 * Everything it creates is tagged `[demo]` in its notes, and `clearDemoData`
 * removes exactly what it made — so a business can try it on a real account
 * and take it back out without touching their own records.
 */

const TAG = '[demo]';

export interface DemoResult {
  created: Record<string, number>;
  error: string | null;
}

export async function loadDemoData(session: BusinessSession): Promise<DemoResult> {
  const supabase = await createClient();
  const businessId = session.business.id;
  const today = todayInAustralia();
  const created: Record<string, number> = {};

  const number = async (kind: string): Promise<string> => {
    const { data } = await supabase.rpc('next_document_number', {
      target: businessId,
      doc_kind: kind,
    });
    return data ?? `${kind.toUpperCase()}-0000`;
  };

  // --- customers -----------------------------------------------------------
  const { data: customers, error: customerError } = await supabase
    .from('customers')
    .insert([
      {
        business_id: businessId,
        name: 'Dana Whitfield',
        company: 'Harbourside Property Group',
        email: 'dana@harbourside.example',
        phone: '0412 555 108',
        abn: '51824753556',
        contact_person: 'Dana Whitfield',
        address_line1: '88 Wharf Road',
        suburb: 'Pyrmont',
        state: 'NSW',
        postcode: '2009',
        notes: `${TAG} Prefers a call to an email. Invoices go to accounts@harbourside.example.`,
        created_by: session.userId,
      },
      {
        business_id: businessId,
        name: 'Marcus Iereti',
        company: null,
        email: 'marcus.iereti@example.com',
        phone: '0403 771 226',
        address_line1: '14 Wattle Street',
        suburb: 'Marrickville',
        state: 'NSW',
        postcode: '2204',
        notes: `${TAG} Owner-builder. Gate code 4821, dog in the yard.`,
        created_by: session.userId,
      },
      {
        business_id: businessId,
        name: 'Priya Raman',
        company: 'Corvus Construction',
        email: 'priya@corvus.example',
        phone: '0455 902 310',
        contact_person: 'Priya Raman',
        address_line1: '3/210 Parramatta Road',
        suburb: 'Auburn',
        state: 'NSW',
        postcode: '2144',
        notes: `${TAG} Head contractor. Wants a daily site report by 5pm.`,
        created_by: session.userId,
      },
    ])
    .select('id, name');

  if (customerError || !customers) {
    return { created, error: customerError?.message ?? 'Customers could not be created.' };
  }
  created.customers = customers.length;

  const [harbourside, marcus, corvus] = customers;

  // --- suppliers and materials --------------------------------------------
  const { data: suppliers } = await supabase
    .from('suppliers')
    .insert([
      {
        business_id: businessId,
        name: 'Austral Bricks — Sydney',
        contact_person: 'Trade desk',
        phone: '13 12 12',
        account_number: 'IB-4471',
        notes: `${TAG}`,
      },
      {
        business_id: businessId,
        name: 'Coates Hire',
        phone: '13 15 52',
        account_number: 'CH-88210',
        notes: `${TAG}`,
      },
    ])
    .select('id, name');

  created.suppliers = suppliers?.length ?? 0;

  await supabase.from('materials').insert([
    {
      business_id: businessId,
      supplier_id: suppliers?.[0]?.id ?? null,
      name: 'Face brick — Bowral Blue',
      sku: 'AB-BB-230',
      unit: 'each',
      unit_cost_cents: 178,
      unit_price_cents: 245,
      description: `${TAG} Standard 230mm.`,
    },
    {
      business_id: businessId,
      supplier_id: suppliers?.[0]?.id ?? null,
      name: 'Mortar — off-white',
      sku: 'AB-MO-20',
      unit: 'each',
      unit_cost_cents: 1850,
      unit_price_cents: 2600,
      description: `${TAG} 20kg bag.`,
    },
    {
      business_id: businessId,
      supplier_id: suppliers?.[1]?.id ?? null,
      name: 'Scaffold hire',
      unit: 'week',
      unit_cost_cents: 32_000,
      unit_price_cents: 45_000,
      description: `${TAG} Mobile tower, delivered.`,
    },
  ]);

  // --- leads ---------------------------------------------------------------
  await supabase.from('leads').insert([
    {
      business_id: businessId,
      name: 'Tom Beckwith',
      phone: '0421 118 774',
      email: 'tom.beckwith@example.com',
      source: 'Word of mouth',
      description: `${TAG} Wants a retaining wall along the back boundary, about 18 metres. Sloping block.`,
      status: 'qualified',
      estimated_value_cents: 1_850_000,
      site_address: '7 Kembla Street, Arncliffe NSW 2205',
      next_follow_up_at: addDays(today, 3),
      created_by: session.userId,
    },
    {
      business_id: businessId,
      name: 'Ellen Moroney',
      phone: '0400 662 019',
      source: 'Sign on the fence',
      description: `${TAG} Repointing to a federation front facade.`,
      status: 'new',
      estimated_value_cents: 620_000,
      site_address: '22 Denison Road, Lewisham NSW 2049',
      next_follow_up_at: addDays(today, 1),
      created_by: session.userId,
    },
  ]);
  created.leads = 2;

  // --- jobs ----------------------------------------------------------------
  const jobRows = [
    {
      customer: marcus!.id,
      name: 'Front elevation rebuild',
      description:
        `${TAG} Demolish and rebuild the front elevation brickwork to sill level. Supply and lay ` +
        'new face brick to match, including lintels over both openings and new weep holes.',
      site: { line1: '14 Wattle Street', suburb: 'Marrickville', postcode: '2204' },
      status: 'in_progress' as const,
      start: addDays(today, -12),
      due: addDays(today, 6),
      budget: 780_000,
    },
    {
      customer: harbourside!.id,
      name: 'Basement blockwork — stage 2',
      description: `${TAG} Core-filled blockwork to the eastern lift shaft, levels B2 to B1.`,
      site: { line1: '88 Wharf Road', suburb: 'Pyrmont', postcode: '2009' },
      status: 'scheduled' as const,
      start: addDays(today, 9),
      due: addDays(today, 34),
      budget: 4_250_000,
    },
    {
      customer: corvus!.id,
      name: 'Boundary wall and piers',
      description: `${TAG} 42 lineal metres of face brick boundary wall with piers at 3m centres.`,
      site: { line1: '3/210 Parramatta Road', suburb: 'Auburn', postcode: '2144' },
      status: 'completed' as const,
      start: addDays(today, -48),
      due: addDays(today, -9),
      budget: 2_100_000,
    },
    {
      customer: harbourside!.id,
      name: 'Retaining wall — rear courtyard',
      description: `${TAG} Awaiting engineering before it can be priced properly.`,
      site: { line1: '88 Wharf Road', suburb: 'Pyrmont', postcode: '2009' },
      status: 'estimating' as const,
      start: null,
      due: null,
      budget: null,
    },
  ];

  const jobIds: string[] = [];
  for (const row of jobRows) {
    const { data: job } = await supabase
      .from('jobs')
      .insert({
        business_id: businessId,
        customer_id: row.customer,
        number: await number('job'),
        name: row.name,
        description: row.description,
        site_address_line1: row.site.line1,
        site_suburb: row.site.suburb,
        site_state: 'NSW',
        site_postcode: row.site.postcode,
        status: row.status,
        start_date: row.start,
        expected_completion_date: row.due,
        budget_cents: row.budget,
        notes: TAG,
        created_by: session.userId,
      })
      .select('id')
      .single();
    if (job) jobIds.push(job.id);
  }
  created.jobs = jobIds.length;

  const [wattle, pyrmont, auburn] = jobIds;

  // --- estimate ------------------------------------------------------------
  const { data: estimate } = await supabase
    .from('estimates')
    .insert({
      business_id: businessId,
      customer_id: marcus!.id,
      job_id: wattle,
      number: await number('estimate'),
      title: 'Front elevation rebuild',
      status: 'converted',
      markup_bp: 2000,
      contingency_bp: 500,
      gst_applies: session.business.gst_registered,
      notes: `${TAG} Allowed two days for scaffold. Brick price held to end of month.`,
      created_by: session.userId,
    })
    .select('id')
    .single();

  if (estimate) {
    await supabase.from('estimate_items').insert([
      {
        business_id: businessId,
        estimate_id: estimate.id,
        kind: 'labour',
        description: 'Bricklayer and labourer',
        quantity_milli: 96_000,
        unit: 'hour',
        unit_cost_cents: 8500,
        position: 0,
      },
      {
        business_id: businessId,
        estimate_id: estimate.id,
        kind: 'materials',
        description: 'Face brick to match existing',
        quantity_milli: 2_400_000,
        unit: 'each',
        unit_cost_cents: 178,
        position: 1,
      },
      {
        business_id: businessId,
        estimate_id: estimate.id,
        kind: 'materials',
        description: 'Mortar, ties and lintels',
        quantity_milli: 1000,
        unit: 'lot',
        unit_cost_cents: 96_000,
        position: 2,
      },
      {
        business_id: businessId,
        estimate_id: estimate.id,
        kind: 'equipment',
        description: 'Scaffold hire',
        quantity_milli: 3000,
        unit: 'week',
        unit_cost_cents: 32_000,
        position: 3,
      },
      {
        business_id: businessId,
        estimate_id: estimate.id,
        kind: 'other',
        description: 'Waste removal and site clean',
        quantity_milli: 1000,
        unit: 'lot',
        unit_cost_cents: 48_000,
        position: 4,
      },
    ]);
    created.estimates = 1;
  }

  // --- quotes --------------------------------------------------------------
  const quoteSpecs = [
    {
      customer: marcus!.id,
      job: wattle,
      title: 'Front elevation rebuild',
      status: 'accepted' as const,
      issue: addDays(today, -26),
      expiry: addDays(today, 4),
      accepted: true,
      items: [
        ['Demolish existing front elevation brickwork to sill level', 1000, 'lot', 168_000],
        ['Supply and lay face brick to match existing', 42_000, 'm²', 18_500],
        ['Lintels over both openings, supply and install', 2000, 'each', 34_000],
        ['Scaffold hire and erection', 3000, 'week', 45_000],
        ['Site clean and waste removal', 1000, 'lot', 62_000],
      ] as const,
    },
    {
      customer: harbourside!.id,
      job: pyrmont,
      title: 'Basement blockwork — stage 2',
      status: 'sent' as const,
      issue: addDays(today, -5),
      expiry: addDays(today, 25),
      accepted: false,
      items: [
        ['Core-filled blockwork to lift shaft, B2 to B1', 186_000, 'm²', 21_500],
        ['Reinforcement, supply and fix', 1000, 'lot', 412_000],
        ['Pump hire and concrete placement', 4000, 'day', 118_000],
      ] as const,
    },
    {
      customer: corvus!.id,
      job: auburn,
      title: 'Boundary wall and piers',
      status: 'accepted' as const,
      issue: addDays(today, -56),
      expiry: addDays(today, -26),
      accepted: true,
      items: [
        ['Face brick boundary wall, 42 lineal metres', 42_000, 'lm', 38_000],
        ['Piers at 3m centres, 15 no.', 15_000, 'each', 24_500],
        ['Capping and weatherproofing', 42_000, 'lm', 4200],
      ] as const,
    },
  ];

  const quoteIds: string[] = [];
  for (const spec of quoteSpecs) {
    const { data: quote } = await supabase
      .from('quotes')
      .insert({
        business_id: businessId,
        customer_id: spec.customer,
        job_id: spec.job,
        estimate_id: spec.job === wattle ? (estimate?.id ?? null) : null,
        number: await number('quote'),
        title: spec.title,
        status: spec.status,
        issue_date: spec.issue,
        expiry_date: spec.expiry,
        gst_applies: session.business.gst_registered,
        scope_of_work: `${TAG} As described, to the standard shown on the drawings issued with this quote.`,
        payment_terms: 'Payment within 14 days of invoice.',
        terms:
          'Prices hold for the validity period shown. Variations are quoted separately in ' +
          'writing before work proceeds.',
        sent_at: new Date(`${spec.issue}T09:00:00Z`).toISOString(),
        accepted_at: spec.accepted ? new Date(`${spec.issue}T15:20:00Z`).toISOString() : null,
        accepted_by_name: spec.accepted ? 'Customer' : null,
        created_by: session.userId,
      })
      .select('id')
      .single();

    if (quote) {
      quoteIds.push(quote.id);
      await supabase.from('quote_items').insert(
        spec.items.map(([description, quantity, unit, price], position) => ({
          business_id: businessId,
          quote_id: quote.id,
          description,
          quantity_milli: quantity,
          unit,
          unit_price_cents: price,
          position,
        }))
      );
    }
  }
  created.quotes = quoteIds.length;

  // --- invoices and payments ----------------------------------------------
  // One part paid, one overdue, one settled — so every status is visible.
  const invoiceSpecs = [
    {
      customer: marcus!.id,
      job: wattle,
      quote: quoteIds[0],
      title: 'Front elevation rebuild — progress claim 1',
      issue: addDays(today, -18),
      due: addDays(today, -4),
      items: [['Progress claim 1 — demolition and preparation', 1000, 'lot', 285_000]] as const,
      paid: 150_000,
    },
    {
      customer: corvus!.id,
      job: auburn,
      quote: quoteIds[2],
      title: 'Boundary wall and piers — final',
      issue: addDays(today, -14),
      due: today,
      items: [
        ['Boundary wall, 42 lineal metres', 42_000, 'lm', 38_000],
        ['Piers, 15 no.', 15_000, 'each', 24_500],
        ['Capping', 42_000, 'lm', 4200],
      ] as const,
      paid: 0,
    },
    {
      customer: corvus!.id,
      job: auburn,
      quote: null,
      title: 'Boundary wall — deposit',
      issue: addDays(today, -52),
      due: addDays(today, -38),
      items: [['Deposit, 30%', 1000, 'lot', 700_000]] as const,
      paidInFull: true,
    },
  ];

  let invoiceCount = 0;
  for (const spec of invoiceSpecs) {
    const { data: invoice } = await supabase
      .from('invoices')
      .insert({
        business_id: businessId,
        customer_id: spec.customer,
        job_id: spec.job,
        quote_id: spec.quote,
        number: await number('invoice'),
        title: spec.title,
        status: 'sent',
        issue_date: spec.issue,
        due_date: spec.due,
        gst_applies: session.business.gst_registered,
        payment_terms: 'Payment due within 14 days.',
        notes: TAG,
        sent_at: new Date(`${spec.issue}T10:00:00Z`).toISOString(),
        created_by: session.userId,
      })
      .select('id')
      .single();

    if (!invoice) continue;
    invoiceCount += 1;

    await supabase.from('invoice_items').insert(
      spec.items.map(([description, quantity, unit, price], position) => ({
        business_id: businessId,
        invoice_id: invoice.id,
        description,
        quantity_milli: quantity,
        unit,
        unit_price_cents: price,
        position,
      }))
    );

    // Read the total back, because the trigger computed it.
    const { data: totals } = await supabase
      .from('invoices')
      .select('total_cents')
      .eq('id', invoice.id)
      .single();

    const amount =
      'paidInFull' in spec && spec.paidInFull
        ? (totals?.total_cents ?? 0)
        : ('paid' in spec ? spec.paid : 0);

    if (amount && amount > 0) {
      await supabase.from('payments').insert({
        business_id: businessId,
        invoice_id: invoice.id,
        customer_id: spec.customer,
        amount_cents: amount,
        method: 'bank_transfer',
        reference: 'Demo payment',
        paid_on: addDays(spec.issue, 6),
        notes: TAG,
        created_by: session.userId,
      });
    }
  }
  created.invoices = invoiceCount;

  // --- reports, work logs, expenses, tasks ---------------------------------
  const { data: dailyTemplate } = await supabase
    .from('report_templates')
    .select('id, key')
    .eq('key', 'daily_site')
    .is('business_id', null)
    .maybeSingle();

  const { data: defectTemplate } = await supabase
    .from('report_templates')
    .select('id, key')
    .eq('key', 'defect')
    .is('business_id', null)
    .maybeSingle();

  if (dailyTemplate && wattle) {
    await supabase.from('reports').insert({
      business_id: businessId,
      template_id: dailyTemplate.id,
      template_key: 'daily_site',
      job_id: wattle,
      customer_id: marcus!.id,
      number: await number('report'),
      title: 'Daily site report — 14 Wattle Street',
      report_date: addDays(today, -1),
      status: 'final',
      summary: `${TAG} Two courses of face brick laid to the front elevation. Lintels set over both openings.`,
      data: {
        weather: 'Fine',
        temperature: 24,
        crew_on_site: 'Sam Marsh\nDaniel Okafor',
        start_time: '07:00',
        finish_time: '15:30',
        break_minutes: 30,
        work_completed:
          'Two courses of face brick to the front elevation. Lintels set over both openings and ' +
          'bedded. Weep holes formed at 1200 centres.',
        materials_used: '620 face brick, 4 bags mortar, 2 lintels',
        equipment_used: 'Mobile scaffold, mixer',
        tomorrow: 'Continue brickwork to sill height, start the eastern return.',
      },
      signature_name: 'S. Marsh',
      signed_at: new Date().toISOString(),
      created_by: session.userId,
    });
  }

  if (defectTemplate && auburn) {
    await supabase.from('reports').insert({
      business_id: businessId,
      template_id: defectTemplate.id,
      template_key: 'defect',
      job_id: auburn,
      customer_id: corvus!.id,
      number: await number('report'),
      title: 'Defect report — pier 11 alignment',
      report_date: addDays(today, -7),
      status: 'final',
      summary: `${TAG} Pier 11 out of plumb by 12mm over 1800. Rebuild from the fourth course.`,
      data: {
        location: 'Boundary wall, pier 11',
        element: 'Brickwork',
        description:
          'Pier 11 is out of plumb by 12mm over 1800mm. Visible from the driveway approach.',
        severity: 'Moderate',
        cause: 'Line moved during the afternoon pour on the adjacent slab.',
        action_required: 'Take down from the fourth course and rebuild to line.',
        responsible: 'Us',
        status: 'Open',
      },
      signature_name: 'S. Marsh',
      signed_at: new Date().toISOString(),
      created_by: session.userId,
    });
    created.reports = 2;
  }

  if (wattle) {
    await supabase.from('work_logs').insert([
      {
        business_id: businessId,
        job_id: wattle,
        work_date: addDays(today, -1),
        start_time: '07:00',
        finish_time: '15:30',
        break_minutes: 30,
        worker_count: 2,
        work_completed: `${TAG} Two courses of face brick, lintels set.`,
        materials_used: '620 brick, 4 bags mortar',
        weather: 'Fine',
        created_by: session.userId,
      },
      {
        business_id: businessId,
        job_id: wattle,
        work_date: addDays(today, -2),
        start_time: '07:00',
        finish_time: '14:00',
        break_minutes: 30,
        worker_count: 2,
        work_completed: `${TAG} Demolition completed, area cleaned down and set out.`,
        weather: 'Light rain',
        problems: 'Lost an hour to rain in the morning.',
        created_by: session.userId,
      },
    ]);
    created.timesheets = 2;

    await supabase.from('expenses').insert([
      {
        business_id: businessId,
        job_id: wattle,
        supplier_id: suppliers?.[0]?.id ?? null,
        category: 'materials',
        description: 'Face brick — 1,200 delivered',
        amount_cents: 234_960,
        gst_cents: 21_360,
        spent_on: addDays(today, -10),
        reference: 'DK-88213',
        notes: TAG,
        created_by: session.userId,
      },
      {
        business_id: businessId,
        job_id: wattle,
        supplier_id: suppliers?.[1]?.id ?? null,
        category: 'equipment',
        description: 'Scaffold hire — 3 weeks',
        amount_cents: 105_600,
        gst_cents: 9600,
        spent_on: addDays(today, -12),
        reference: 'CH-99120',
        notes: TAG,
        created_by: session.userId,
      },
      {
        business_id: businessId,
        job_id: wattle,
        category: 'other',
        description: 'Skip bin',
        amount_cents: 49_500,
        gst_cents: 4500,
        spent_on: addDays(today, -11),
        notes: TAG,
        created_by: session.userId,
      },
    ]);
    created.expenses = 3;

    await supabase.from('job_tasks').insert([
      {
        business_id: businessId,
        job_id: wattle,
        customer_id: marcus!.id,
        title: 'Repair damaged brickwork before Friday',
        description: `${TAG} Customer rang about a cracked brick near the front window.`,
        priority: 'high',
        status: 'open',
        due_date: addDays(today, 2),
        source: 'customer_request',
        created_by: session.userId,
      },
      {
        business_id: businessId,
        job_id: auburn,
        customer_id: corvus!.id,
        title: 'Rebuild pier 11 from the fourth course',
        description: `${TAG} From the defect report.`,
        priority: 'urgent',
        status: 'in_progress',
        due_date: addDays(today, 1),
        source: 'defect',
        created_by: session.userId,
      },
      {
        business_id: businessId,
        job_id: pyrmont,
        title: 'Order second batch of blocks for stage 2',
        priority: 'medium',
        status: 'open',
        due_date: addDays(today, 5),
        source: 'manual',
        created_by: session.userId,
      },
      {
        business_id: businessId,
        title: 'Chase Corvus on the final invoice',
        priority: 'medium',
        status: 'open',
        due_date: addDays(today, 3),
        customer_id: corvus!.id,
        source: 'manual',
        created_by: session.userId,
      },
    ]);
    created.tasks = 4;
  }

  // --- the AI brain --------------------------------------------------------
  await supabase.rpc('ensure_ai_brain', { target: businessId });
  await supabase
    .from('ai_brain')
    .update({
      industry_key: 'bricklayer',
      tone: 'friendly',
      greeting: `Hi, you've reached ${session.business.name}.`,
      services: ['Face brickwork', 'Blockwork', 'Retaining walls', 'Repointing', 'Brick repairs'],
      service_area: 'Sydney metropolitan area, inner west and city',
      business_hours: {
        monday: '7:00am – 5:00pm',
        tuesday: '7:00am – 5:00pm',
        wednesday: '7:00am – 5:00pm',
        thursday: '7:00am – 5:00pm',
        friday: '7:00am – 4:00pm',
        saturday: 'Closed',
        sunday: 'Closed',
      },
      emergency_hours: 'Make-safe only outside hours, at the after-hours rate.',
      staff: [
        { name: 'Sam', role: 'supervisor', note: 'On site most days, best on the mobile' },
        { name: 'Priya', role: 'office manager', note: 'Accounts and scheduling' },
      ],
      escalation_name: 'Sam',
      forbidden_topics: [
        'Anything about another customer or another job',
        'What we pay our staff',
        'Who else is quoting a job',
        'Whether a defect is our legal liability',
      ],
      policies:
        `${TAG} Never commit to a start date — Priya does the scheduling.\n` +
        'If a caller mentions water coming through a wall, treat it as urgent and escalate.\n' +
        'We do not work on strata common property.',
      may_share_job_status: true,
      may_discuss_pricing: false,
      may_confirm_bookings: false,
    })
    .eq('business_id', businessId);

  await supabase.from('ai_faqs').insert([
    {
      business_id: businessId,
      question: 'Do you do weekend work?',
      answer:
        'We work Monday to Friday. Saturdays are emergency make-safe only, at the after-hours rate.',
      category: 'Scheduling',
      position: 0,
    },
    {
      business_id: businessId,
      question: 'How long does a brick wall take?',
      answer:
        'It depends on the height and the access, but a typical boundary wall is about a day for ' +
        'every eight to ten lineal metres once the footing is in. Sam can give you a real answer ' +
        'after a look at the site.',
      category: 'Timing',
      position: 1,
    },
    {
      business_id: businessId,
      question: 'Do you provide materials?',
      answer:
        'Yes — brick, mortar, ties and lintels are all in our quotes unless it says otherwise. ' +
        'If you want a particular brick we are happy to work with it.',
      category: 'Scope',
      position: 2,
    },
    {
      business_id: businessId,
      question: 'Can you match existing bricks?',
      answer:
        'Usually. Send a photo with something for scale and we will tell you what we can source. ' +
        'On older homes we sometimes recommend reclaimed brick instead of a new match.',
      category: 'Scope',
      position: 3,
    },
  ]);
  created.faqs = 4;

  await supabase.from('ai_knowledge').insert({
    business_id: businessId,
    title: 'How we handle warranty callbacks',
    body:
      `${TAG} Anything within twelve months of practical completion, take the details and mark it ` +
      'urgent. Do not tell the customer whether it is covered — Sam decides that after a look.',
    category: 'Policy',
    approved: true,
    created_by: session.userId,
  });

  return { created, error: null };
}

/**
 * Remove exactly what the demo created. Everything it wrote carries `[demo]`
 * in a text field, so a business that loaded it into a live account gets its
 * own records back untouched.
 */
export async function clearDemoData(session: BusinessSession): Promise<{ removed: number }> {
  const supabase = await createClient();
  const businessId = session.business.id;
  const stamp = new Date().toISOString();
  let removed = 0;

  const softDelete = async (
    table: 'customers' | 'jobs' | 'leads' | 'suppliers' | 'materials' | 'estimates' | 'quotes' |
      'invoices' | 'reports' | 'work_logs' | 'expenses' | 'job_tasks' | 'payments' | 'ai_faqs' |
      'ai_knowledge',
    column: string
  ) => {
    const { data } = await supabase
      .from(table)
      .update({ deleted_at: stamp })
      .eq('business_id', businessId)
      .is('deleted_at', null)
      .ilike(column, `%${TAG}%`)
      .select('id');
    removed += data?.length ?? 0;
  };

  // Children first, so nothing is orphaned in a list before its parent goes.
  await softDelete('payments', 'notes');
  await softDelete('job_tasks', 'description');
  await softDelete('expenses', 'notes');
  await softDelete('work_logs', 'work_completed');
  await softDelete('reports', 'summary');
  await softDelete('invoices', 'notes');
  await softDelete('quotes', 'scope_of_work');
  await softDelete('estimates', 'notes');
  await softDelete('materials', 'description');
  await softDelete('suppliers', 'notes');
  await softDelete('leads', 'description');
  await softDelete('jobs', 'notes');
  await softDelete('customers', 'notes');
  await softDelete('ai_knowledge', 'body');

  // FAQs have no free-text field to tag, so they are matched by their question.
  const { data: faqs } = await supabase
    .from('ai_faqs')
    .update({ deleted_at: stamp })
    .eq('business_id', businessId)
    .is('deleted_at', null)
    .in('question', [
      'Do you do weekend work?',
      'How long does a brick wall take?',
      'Do you provide materials?',
      'Can you match existing bricks?',
    ])
    .select('id');
  removed += faqs?.length ?? 0;

  return { removed };
}
