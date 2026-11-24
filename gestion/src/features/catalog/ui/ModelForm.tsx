import { ActionForm } from "@/components/form/ActionForm";
import { FormCheckbox, FormField, FormSelect, FormTextarea } from "@/components/form/fields";
import { saveModelAction } from "../model-actions";
import type { LineOption, ModelRow } from "../queries";

export function ModelForm({ lines, model }: { lines: readonly LineOption[]; model?: ModelRow }) {
  const options = lines.filter((line) => line.active || line.id === model?.lineId);
  return (
    <ActionForm action={saveModelAction} submitLabel={model ? "Guardar modelo" : "Crear modelo"}>
      {model ? <input type="hidden" name="id" value={model.id} /> : null}
      <div className="form-grid">
        <FormSelect label="Línea" name="lineId" defaultValue={model?.lineId ?? ""} required>
          <option value="" disabled>
            Seleccione…
          </option>
          {options.map((line) => (
            <option key={line.id} value={line.id}>
              {line.name}
            </option>
          ))}
        </FormSelect>
        <FormField label="Nombre del modelo" name="name" defaultValue={model?.name} autoComplete="off" required maxLength={80} />
        <FormField
          label="Precio base (Bs)"
          name="basePrice"
          inputMode="decimal"
          defaultValue={model?.price ?? ""}
          placeholder="189,00"
          hint="Precio de lista; en caja se puede ajustar por venta."
          required
        />
      </div>
      <FormTextarea label="Descripción (opcional)" name="description" defaultValue={model?.description ?? ""} rows={3} />
      {model ? <FormCheckbox label="Modelo activo (visible para vender)" name="active" defaultChecked={model.active} /> : null}
    </ActionForm>
  );
}
