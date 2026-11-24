import { ActionForm } from "@/components/form/ActionForm";
import { FormField, FormSelect } from "@/components/form/fields";
import { deleteModelPhotoAction, makeCoverPhotoAction, setPublishedAction, uploadModelPhotoAction } from "../actions";
import type { ModelPhoto } from "../queries";
import { UploadForm } from "./UploadForm";

interface Props {
  readonly modelId: string;
  readonly published: boolean;
  readonly sellable: boolean;
  readonly photos: readonly ModelPhoto[];
  readonly colors: readonly { id: string; name: string }[];
}

/** "Tienda online" block of a model: publish switch and photos (sharp-optimized WebP stored in Postgres). */
export function ModelStorePanel({ modelId, published, sellable, photos, colors }: Props) {
  return (
    <div className="stack">
      <ActionForm action={setPublishedAction} submitLabel={published ? "Quitar de la tienda" : "Publicar en la tienda"} submitClassName={published ? "btn btn--danger" : "btn btn--primary"} submitDisabled={!published && !sellable} pendingLabel="Guardando…" className="store-publish">
        <input type="hidden" name="ids" value={modelId} />
        <input type="hidden" name="mode" value={published ? "unpublish" : "publish"} />
        <p>
          {published ? <span className="badge badge--ok">Publicado</span> : <span className="badge badge--low">No publicado</span>}{" "}
          {published ? "Los clientes ya pueden verlo y comprarlo." : sellable ? "Visible solo para el equipo hasta que lo publique." : "Para publicarlo debe estar activo, tener precio y al menos una variante."}
        </p>
        {published && photos.length === 0 ? <p className="notice">Aún no tiene fotos: se muestra una imagen de marca. Suba al menos una.</p> : null}
      </ActionForm>

      {photos.length > 0 ? (
        <ul className="photo-grid" aria-label="Fotos del modelo">
          {photos.map((photo, index) => (
            <li key={photo.id} className="photo">
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated preview route */}
              <img src={`/tienda-online/foto/${photo.id}`} alt={photo.alt ?? `Foto ${index + 1}`} width={photo.width} height={photo.height} loading="lazy" />
              <p className="photo__meta">
                {index === 0 ? <strong>Principal · </strong> : null}
                {photo.colorName ?? "Todos los colores"}
              </p>
              <div className="photo__actions">
                {index > 0 ? (
                  <ActionForm action={makeCoverPhotoAction} submitLabel="Hacer principal" submitClassName="btn btn--small" className="inline-form">
                    <input type="hidden" name="imageId" value={photo.id} />
                    <input type="hidden" name="modelId" value={modelId} />
                  </ActionForm>
                ) : null}
                <ActionForm action={deleteModelPhotoAction} submitLabel="Eliminar" submitClassName="btn btn--small btn--danger" className="inline-form">
                  <input type="hidden" name="imageId" value={photo.id} />
                  <input type="hidden" name="modelId" value={modelId} />
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {photos.length < 12 ? (
        <UploadForm action={uploadModelPhotoAction} fileName="photo" label="Agregar foto" hint="Se reduce y convierte a WebP (máx. 900 px, ~150 KB). Hasta 12 por modelo." submitLabel="Subir foto">
          <input type="hidden" name="modelId" value={modelId} />
          <div className="form-grid">
            <FormSelect label="Color de la foto" name="colorId" defaultValue="" hint="Si es de un color, se muestra al elegir ese color.">
              <option value="">Todos los colores</option>
              {colors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FormSelect>
            <FormField label="Descripción de la foto (opcional)" name="alt" maxLength={160} />
          </div>
        </UploadForm>
      ) : <p className="notice">Llegó al máximo de 12 fotos.</p>}
    </div>
  );
}
