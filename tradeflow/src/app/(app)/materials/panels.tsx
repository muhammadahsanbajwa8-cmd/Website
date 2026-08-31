'use client';

import { useActionState } from 'react';
import { saveMaterialAction, saveSupplierAction } from '../field/actions';
import { idleState } from '@/lib/action-state';
import { UNITS } from '@/lib/domain';
import {
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  FormError,
  FormSuccess,
  Input,
  MoneyInput,
  Select,
  Textarea,
} from '@/components/ui';
import { SubmitButton } from '@/components/ui/client';

/** Add forms alongside the lists, so the price book fills up without a page change. */
export function CataloguePanels({
  canEdit,
  suppliers,
}: {
  canEdit: boolean;
  suppliers: { id: string; name: string }[];
}) {
  const [materialState, materialAction] = useActionState(saveMaterialAction, idleState);
  const [supplierState, supplierAction] = useActionState(saveSupplierAction, idleState);

  if (!canEdit) return null;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Add a material" />
        <CardBody>
          <form action={materialAction} className="space-y-4">
            <FormError>{materialState.error}</FormError>
            {materialState.ok && materialState.message ? (
              <FormSuccess>{materialState.message}</FormSuccess>
            ) : null}

            <Field label="Name" htmlFor="material-name" error={materialState.fieldErrors?.name} required>
              <Input id="material-name" name="name" required placeholder="Face brick, red" />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="SKU" htmlFor="material-sku">
                <Input id="material-sku" name="sku" />
              </Field>
              <Field label="Unit" htmlFor="material-unit">
                <Select id="material-unit" name="unit" defaultValue="each">
                  {UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cost" htmlFor="material-cost">
                <MoneyInput id="material-cost" name="unitCost" />
              </Field>
              <Field label="Price" htmlFor="material-price">
                <MoneyInput id="material-price" name="unitPrice" />
              </Field>
            </div>

            {suppliers.length > 0 ? (
              <Field label="Supplier" htmlFor="material-supplier">
                <Select id="material-supplier" name="supplierId" defaultValue="">
                  <option value="">Not set</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <Checkbox name="taxable" defaultChecked label="GST applies" />

            <SubmitButton className="w-full" pendingLabel="Adding…">
              Add material
            </SubmitButton>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Add a supplier" />
        <CardBody>
          <form action={supplierAction} className="space-y-4">
            <FormError>{supplierState.error}</FormError>
            {supplierState.ok && supplierState.message ? (
              <FormSuccess>{supplierState.message}</FormSuccess>
            ) : null}

            <Field label="Name" htmlFor="supplier-name" error={supplierState.fieldErrors?.name} required>
              <Input id="supplier-name" name="name" required placeholder="Boral Bricks" />
            </Field>

            <Field label="Contact" htmlFor="supplier-contact">
              <Input id="supplier-contact" name="contactPerson" />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone" htmlFor="supplier-phone">
                <Input id="supplier-phone" name="phone" type="tel" />
              </Field>
              <Field label="Account no." htmlFor="supplier-account">
                <Input id="supplier-account" name="accountNumber" />
              </Field>
            </div>

            <Field label="Email" htmlFor="supplier-email" error={supplierState.fieldErrors?.email}>
              <Input id="supplier-email" name="email" type="email" autoCapitalize="none" />
            </Field>

            <Field label="Notes" htmlFor="supplier-notes">
              <Textarea id="supplier-notes" name="notes" rows={2} />
            </Field>

            <SubmitButton className="w-full" pendingLabel="Adding…">
              Add supplier
            </SubmitButton>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
