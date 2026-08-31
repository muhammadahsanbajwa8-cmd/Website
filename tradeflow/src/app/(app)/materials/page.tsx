import { requireCapability } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';
import { idsFrom, likePattern, lookup, param } from '@/lib/query';
import { Badge, Card, CardBody, CardHeader, EmptyState, Icon, PageHeader, icons } from '@/components/ui';
import { SearchInput } from '@/components/ui/client';
import { DataTable, FilterBar } from '@/components/list';
import { CataloguePanels } from './panels';
import { formatBasisPoints, formatMoney } from '@/lib/format';
import type { Material, Supplier } from '@/lib/database.types';

export const metadata = { title: 'Materials' };

/**
 * The price book. Cost is what you pay, price is what you charge, and the
 * margin between them is shown so a stale cost is visible at a glance.
 */
export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireCapability('materials.view');
  const params = await searchParams;
  const search = param(params, 'q');

  const supabase = await createClient();
  let query = supabase
    .from('materials')
    .select('*')
    .eq('business_id', session.business.id)
    .is('deleted_at', null);

  if (search) {
    const pattern = likePattern(search);
    query = query.or(`name.ilike.${pattern},sku.ilike.${pattern},description.ilike.${pattern}`);
  }

  const [{ data: materialRows }, { data: supplierRows }] = await Promise.all([
    query.order('name').limit(200),
    supabase
      .from('suppliers')
      .select('*')
      .eq('business_id', session.business.id)
      .is('deleted_at', null)
      .order('name')
      .limit(200),
  ]);

  const materials = (materialRows ?? []) as Material[];
  const suppliers = (supplierRows ?? []) as Supplier[];
  const supplierNames = await lookup(
    'suppliers',
    idsFrom(materials, (m) => m.supplier_id),
    'id, name'
  );

  return (
    <>
      <PageHeader
        title="Materials and suppliers"
        description="Your price book, so a quote line does not need looking up twice."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div>
          <FilterBar>
            <SearchInput placeholder="Search materials…" />
          </FilterBar>

          <DataTable
            rows={materials}
            empty={
              <EmptyState
                icon={<Icon path={icons.materials} size={20} />}
                title={search ? 'Nothing matches that' : 'No materials yet'}
                description="Add the things you buy often, with what they cost and what you charge."
              />
            }
            columns={[
              {
                key: 'name',
                header: 'Material',
                render: (material) => (
                  <span>
                    <span className="block">{material.name}</span>
                    <span className="block text-xs font-normal text-[var(--text-muted)]">
                      {[material.sku, `per ${material.unit}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                ),
              },
              {
                key: 'supplier',
                header: 'Supplier',
                secondary: true,
                render: (material) => {
                  const supplier = material.supplier_id
                    ? supplierNames.get(material.supplier_id)
                    : null;
                  return (
                    <span className="text-sm text-[var(--text-muted)]">
                      {supplier ? supplier.name : '—'}
                    </span>
                  );
                },
              },
              {
                key: 'cost',
                header: 'Cost',
                align: 'right',
                render: (material) => (
                  <span className="tabular text-sm text-[var(--text-muted)]">
                    {formatMoney(material.unit_cost_cents)}
                  </span>
                ),
              },
              {
                key: 'price',
                header: 'Price',
                align: 'right',
                render: (material) => (
                  <span className="tabular text-sm font-medium">
                    {formatMoney(material.unit_price_cents)}
                  </span>
                ),
              },
              {
                key: 'margin',
                header: 'Margin',
                align: 'right',
                render: (material) => {
                  if (material.unit_price_cents <= 0) {
                    return <span className="text-sm text-[var(--text-muted)]">—</span>;
                  }
                  const bp = Math.round(
                    ((material.unit_price_cents - material.unit_cost_cents) /
                      material.unit_price_cents) *
                      10000
                  );
                  return (
                    <Badge tone={bp <= 0 ? 'danger' : bp < 1500 ? 'warning' : 'success'}>
                      {formatBasisPoints(bp)}
                    </Badge>
                  );
                },
              },
            ]}
          />

          <Card className="mt-5">
            <CardHeader title="Suppliers" description={`${suppliers.length} on file`} />
            {suppliers.length === 0 ? (
              <CardBody>
                <p className="text-sm text-[var(--text-muted)]">No suppliers yet.</p>
              </CardBody>
            ) : (
              <ul className="divide-y divide-[var(--line-subtle)]">
                {suppliers.map((supplier) => (
                  <li key={supplier.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[var(--text-strong)]">
                        {supplier.name}
                      </span>
                      <span className="block text-xs text-[var(--text-muted)]">
                        {[supplier.contact_person, supplier.phone, supplier.email, supplier.account_number]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <CataloguePanels
          canEdit={session.can('materials.edit')}
          suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        />
      </div>
    </>
  );
}
