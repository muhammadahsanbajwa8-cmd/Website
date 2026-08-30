import { ButtonLink, Card, Icon, icons, InfoNote } from '@/components/ui';
import { MarketingFooter, MarketingNav } from '@/components/marketing';

export const metadata = { title: 'Pricing' };

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    blurb: 'A sole trader getting off paper.',
    cta: 'Start free',
    highlight: false,
    includes: [
      'One user',
      'Unlimited customers and jobs',
      '5 quotes and 5 invoices a month',
      'Quote and invoice PDFs',
      'Daily site reports with photos',
      'Timesheets and expenses',
    ],
    excludes: ['Team members', 'Mailbox connection', 'AI assistant'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$49',
    cadence: 'per month',
    blurb: 'A small crew running several jobs at once.',
    cta: 'Start free',
    highlight: true,
    includes: [
      'Up to 5 team members',
      'Unlimited quotes and invoices',
      'The full report library',
      'Customer quote portal with accept and decline',
      'Mailbox connection and email against jobs',
      'AI assistant and email drafting',
      'Job profitability',
    ],
    excludes: ['Custom report templates'],
  },
  {
    id: 'business',
    name: 'Business',
    price: '$99',
    cadence: 'per month',
    blurb: 'A contractor with office staff and subbies.',
    cta: 'Start free',
    highlight: false,
    includes: [
      'Unlimited team members',
      'Everything in Pro',
      'Custom report templates',
      'Accountant role and exports',
      'Audit log',
      'Priority support',
    ],
    excludes: [],
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-page)]">
      <MarketingNav />

      <main id="main" className="px-4 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Priced per business, not per job
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-[var(--text-muted)]">
              Start on Free with no card. Everything you enter stays yours if you move
              plans, and you can export at any time.
            </p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {PLANS.map((plan) => (
              <Card
                key={plan.id}
                className={
                  plan.highlight
                    ? 'relative border-[var(--accent)] p-6 shadow-[var(--shadow-raised)]'
                    : 'p-6'
                }
              >
                {plan.highlight ? (
                  <span className="absolute -top-3 left-6 rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[var(--accent-on)]">
                    Most popular
                  </span>
                ) : null}

                <h2 className="text-lg font-semibold text-[var(--text-strong)]">{plan.name}</h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{plan.blurb}</p>

                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold tracking-tight text-[var(--text-strong)]">
                    {plan.price}
                  </span>
                  <span className="text-sm text-[var(--text-muted)]">{plan.cadence}</span>
                </div>

                <ButtonLink
                  href="/signup"
                  variant={plan.highlight ? 'primary' : 'secondary'}
                  className="mt-6 w-full"
                >
                  {plan.cta}
                </ButtonLink>

                <ul className="mt-6 space-y-2.5">
                  {plan.includes.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm">
                      <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[var(--ok-soft)] text-[var(--ok)]">
                        <Icon path={icons.check} size={12} />
                      </span>
                      <span className="text-[var(--text-default)]">{item}</span>
                    </li>
                  ))}
                  {plan.excludes.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm opacity-55">
                      <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-muted)]">
                        <Icon path={icons.x} size={12} />
                      </span>
                      <span className="text-[var(--text-muted)]">{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>

          <div className="mx-auto mt-10 max-w-3xl">
            <InfoNote>
              <strong>Billing is not switched on yet.</strong> These are placeholder
              prices and every account has the full platform while the product is being
              finished. Nothing will start charging without you choosing a plan first.
            </InfoNote>
          </div>

          <div className="mx-auto mt-14 max-w-3xl">
            <h2 className="text-xl font-semibold tracking-tight">Questions people ask</h2>
            <dl className="mt-6 space-y-6">
              {[
                [
                  'Does it handle GST properly?',
                  'Yes. GST is 10% on the taxable portion of a document, a line can be marked GST-free, and a discount is spread across lines so it reduces the taxable base in proportion. If your business is not registered, turn GST off and nothing is added anywhere.',
                ],
                [
                  'Can my workers see what I charge?',
                  'Not on the Worker role. Quotes, estimates, invoices and payments are refused for that role by the database itself, not hidden in the interface.',
                ],
                [
                  'What happens to a quote after I send it?',
                  'The customer gets a private link to a page with the PDF. They can download it, accept it, decline it, ask for changes or leave a message. Accepting moves the job and notifies you.',
                ],
                [
                  'Do I need to connect my email?',
                  'No. Quotes and invoices send from the platform. Connecting a mailbox is what puts your existing Gmail or Outlook conversations onto the job they belong to.',
                ],
                [
                  'Is my data mixed in with other businesses?',
                  'It is in the same database and separated by row level security: every table carries a business id and Postgres refuses to return a row belonging to another business, regardless of what the application asks for.',
                ],
              ].map(([question, answer]) => (
                <div key={question}>
                  <dt className="font-semibold text-[var(--text-strong)]">{question}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-[var(--text-muted)]">
                    {answer}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
