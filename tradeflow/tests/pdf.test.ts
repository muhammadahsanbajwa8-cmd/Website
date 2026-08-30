import { describe, it, expect } from 'vitest';
import { renderPricedDocument } from '@/lib/pdf/priced-document';
import { renderReport } from '@/lib/pdf/report';
import { parseSections, readAnswers, missingRequired } from '@/lib/reports';

const business = {
  name: 'Ironbark Building Services',
  abn: '51824753556',
  email: 'accounts@ironbark.example',
  phone: '0400 123 456',
  address_line1: '12 Forge Lane',
  address_line2: null,
  suburb: 'Marrickville',
  state: 'NSW',
  postcode: '2204',
  gst_registered: true,
  bank_account_name: 'Ironbark Building Services',
  bank_bsb: '062000',
  bank_account_number: '12345678',
};

const customer = {
  name: 'Dana Whitfield',
  company: 'Harbourside Property Group',
  email: 'dana@harbourside.example',
  phone: '0299991234',
  address_line1: '88 Wharf Road',
  suburb: 'Pyrmont',
  state: 'NSW',
  postcode: '2009',
};

/** A PDF begins with %PDF- and ends with the EOF marker. */
function looksLikePdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.slice(0, 5));
  const tail = new TextDecoder().decode(bytes.slice(-1024));
  return head === '%PDF-' && tail.includes('%%EOF');
}

describe('quote and invoice PDFs', () => {
  const items = [
    {
      description: 'Supply and lay face brickwork to front elevation',
      detail: 'Includes cleaning down and raking joints',
      quantity_milli: 42_000,
      unit: 'm²',
      unit_price_cents: 18_500,
      taxable: true,
    },
    {
      description: 'Scaffold hire',
      detail: null,
      quantity_milli: 3000,
      unit: 'week',
      unit_price_cents: 45_000,
      taxable: true,
    },
  ];

  it('renders a quote', async () => {
    const bytes = await renderPricedDocument({
      kind: 'quote',
      business,
      customer,
      number: 'QUO-0007',
      title: 'Front elevation rebuild',
      issueDate: '2026-03-04',
      secondaryDate: '2026-04-03',
      jobReference: 'JOB-0042 — 14 Wattle Street',
      scope: 'Demolish and rebuild the front elevation brickwork, including lintels.',
      terms: 'Prices hold for 30 days. Variations are quoted separately in writing.',
      paymentTerms: '30% deposit, balance on completion, 14 days.',
      items,
      discountCents: 0,
      subtotalCents: 912_000,
      taxCents: 91_200,
      totalCents: 1_003_200,
      gstApplies: true,
    });

    expect(looksLikePdf(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(1500);
  });

  it('renders a tax invoice with a part payment', async () => {
    const bytes = await renderPricedDocument({
      kind: 'invoice',
      business,
      customer,
      number: 'INV-0031',
      title: 'Front elevation rebuild',
      issueDate: '2026-04-10',
      secondaryDate: '2026-04-24',
      items,
      discountCents: 10_000,
      subtotalCents: 912_000,
      taxCents: 90_200,
      totalCents: 992_200,
      paidCents: 300_000,
      gstApplies: true,
      notes: 'Thanks for your business.',
    });

    expect(looksLikePdf(bytes)).toBe(true);
  });

  it('renders without GST for an unregistered business', async () => {
    const bytes = await renderPricedDocument({
      kind: 'invoice',
      business: { ...business, gst_registered: false },
      customer,
      number: 'INV-0002',
      issueDate: '2026-04-10',
      items: [{ ...items[0]!, taxable: false }],
      discountCents: 0,
      subtotalCents: 777_000,
      taxCents: 0,
      totalCents: 777_000,
      gstApplies: false,
    });

    expect(looksLikePdf(bytes)).toBe(true);
  });

  it('paginates a document with a hundred lines instead of running off the page', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      description: `Line item ${i + 1} — ${'a rather long description that wraps '.repeat(2)}`,
      detail: 'With a second line of detail underneath it',
      quantity_milli: 1000,
      unit: 'each',
      unit_price_cents: 12_345,
      taxable: i % 4 !== 0,
    }));

    const bytes = await renderPricedDocument({
      kind: 'quote',
      business,
      customer,
      number: 'QUO-0100',
      issueDate: '2026-03-04',
      items: many,
      discountCents: 0,
      subtotalCents: 1_234_500,
      taxCents: 92_587,
      totalCents: 1_327_087,
      gstApplies: true,
    });

    expect(looksLikePdf(bytes)).toBe(true);
    // A hundred two-line rows cannot fit on one A4 page.
    expect(bytes.length).toBeGreaterThan(10_000);
  });

  it('survives a customer with almost nothing filled in', async () => {
    const bytes = await renderPricedDocument({
      kind: 'quote',
      business: {
        ...business,
        abn: null, address_line1: null, address_line2: null,
        suburb: null, state: null, postcode: null, phone: null, email: null,
        bank_account_name: null, bank_bsb: null, bank_account_number: null,
      },
      customer: null,
      number: 'QUO-0001',
      issueDate: '2026-03-04',
      items: [
        { description: 'Call-out', detail: null, quantity_milli: 1000, unit: 'each', unit_price_cents: 15_000, taxable: true },
      ],
      discountCents: 0,
      subtotalCents: 15_000,
      taxCents: 1500,
      totalCents: 16_500,
      gstApplies: true,
    });

    expect(looksLikePdf(bytes)).toBe(true);
  });
});

describe('report templates and PDF', () => {
  const sections = parseSections([
    {
      id: 'site',
      title: 'Site',
      fields: [
        { id: 'weather', label: 'Weather', type: 'select', options: ['Fine', 'Rain'], required: true },
        { id: 'conditions', label: 'Site conditions', type: 'textarea' },
        { id: 'delays', label: 'Delays', type: 'checkbox' },
        { id: 'crew_size', label: 'Crew size', type: 'number' },
      ],
    },
    { id: 'evidence', title: 'Evidence', fields: [{ id: 'photos', label: 'Photos', type: 'photos' }] },
    // Deliberately malformed entries: a field with no id, and a section that
    // is not an object at all.
    { id: 'broken', title: 'Broken', fields: [{ label: 'No id here', type: 'text' }] },
    'not a section',
  ] as never);

  it('parses the good sections and drops the bad ones', () => {
    expect(sections.map((s) => s.id)).toEqual(['site', 'evidence', 'broken']);
    expect(sections[0]!.fields).toHaveLength(4);
    expect(sections[2]!.fields).toHaveLength(0);
  });

  it('reads only declared fields out of a form', () => {
    const form = new FormData();
    form.set('field.weather', 'Fine');
    form.set('field.conditions', '  Wet underfoot  ');
    form.set('field.crew_size', '4');
    form.set('field.delays', 'on');
    // Not in the template — must be ignored.
    form.set('field.injected', 'should not appear');
    form.set('business_id', 'definitely not');

    const answers = readAnswers(sections, form);
    expect(answers).toEqual({
      weather: 'Fine',
      conditions: '  Wet underfoot  ',
      crew_size: 4,
      delays: true,
    });
    expect(answers).not.toHaveProperty('injected');
    expect(answers).not.toHaveProperty('business_id');
  });

  it('treats an unchecked checkbox as false, not missing', () => {
    const answers = readAnswers(sections, new FormData());
    expect(answers.delays).toBe(false);
  });

  it('reports required fields that were left blank', () => {
    expect(missingRequired(sections, {}).map((f) => f.id)).toEqual(['weather']);
    expect(missingRequired(sections, { weather: 'Fine' })).toHaveLength(0);
    expect(missingRequired(sections, { weather: '   ' }).map((f) => f.id)).toEqual(['weather']);
  });

  it('renders a report PDF', async () => {
    const bytes = await renderReport({
      business: { name: business.name, abn: business.abn, phone: business.phone, email: business.email },
      templateName: 'Daily site report',
      sections,
      number: 'REP-0009',
      title: 'Daily site report — 14 Wattle Street',
      reportDate: '2026-03-04',
      status: 'final',
      jobLabel: 'JOB-0042 — Front elevation rebuild',
      customerLabel: 'Harbourside Property Group',
      siteAddress: '14 Wattle Street, Marrickville NSW 2204',
      summary: 'Brickwork to the front elevation continued. Two courses laid.',
      data: { weather: 'Fine', conditions: 'Dry, light wind', delays: false, crew_size: 4 },
      photos: [],
      signatureName: 'S. Marsh',
      signedAt: '2026-03-04T07:12:00Z',
      preparedBy: 'Sam Marsh',
    });

    expect(looksLikePdf(bytes)).toBe(true);
  });

  it('renders a report where nothing was filled in', async () => {
    const bytes = await renderReport({
      business: { name: business.name, abn: null, phone: null, email: null },
      templateName: 'Defect report',
      sections,
      number: 'REP-0010',
      title: 'Defect report',
      reportDate: '2026-03-05',
      status: 'draft',
      data: {},
      photos: [],
    });

    expect(looksLikePdf(bytes)).toBe(true);
  });
});
