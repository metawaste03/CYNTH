import { useEffect, useState, type FormEvent } from 'react';
import type { ProductInput } from '../../shared/types/product';
import { ApiError } from '../../shared/services/apiClient';
import type { Theme } from '../../shared/types/content';
import { fetchThemes } from '../content/api';
import './ProductForm.css';

export interface ProductFormValues {
  title: string;
  brand: string;
  category: string;
  shortDescription: string;
  description: string;
  affiliateLink: string;
  editorialFit: string;
  notes: string;
  isActive: boolean;
  /** The thematic area this product belongs to. Empty string means none (Milestone 18). */
  themeId: string;
  /**
   * What the article writer actually reads (Milestone 27).
   *
   * These were previously writable only by product research. A product added
   * by hand reached the writer as a name and a brand, which is enough to
   * mention it and not enough to place it — so a manually added product could
   * only ever land decoratively.
   */
  useCase: string;
  problemSolved: string;
  bestFor: string;
  /** One per line in the field, sent as a list. */
  keyFeatures: string;
}

export interface PickedImage {
  file: File;
  isPrimary: boolean;
  previewUrl: string;
}

interface ProductFormProps {
  initialValues?: Partial<ProductFormValues>;
  /** Only the create flow picks images inline — replace/remove/add-more happens from the detail page. */
  showImagePicker?: boolean;
  submitLabel: string;
  onSubmit: (input: ProductInput, images: PickedImage[]) => Promise<void>;
}

const EMPTY_VALUES: ProductFormValues = {
  title: '',
  brand: '',
  category: '',
  shortDescription: '',
  description: '',
  affiliateLink: '',
  editorialFit: '',
  notes: '',
  isActive: true,
  themeId: '',
  useCase: '',
  problemSolved: '',
  bestFor: '',
  keyFeatures: '',
};

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';

export function ProductForm({ initialValues, showImagePicker, submitLabel, onSubmit }: ProductFormProps) {
  const [values, setValues] = useState<ProductFormValues>({ ...EMPTY_VALUES, ...initialValues });
  const [primaryImage, setPrimaryImage] = useState<PickedImage | null>(null);
  const [additionalImages, setAdditionalImages] = useState<PickedImage[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The thematic areas are data, so the picker is built from whatever the
  // project has configured — never from a list written into this component.
  const [themes, setThemes] = useState<Theme[]>([]);
  useEffect(() => {
    fetchThemes({ activeOnly: true })
      .then(setThemes)
      .catch(() => setThemes([]));
  }, []);

  function updateField<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function handlePrimaryFileChange(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setPrimaryImage({ file, isPrimary: true, previewUrl: URL.createObjectURL(file) });
  }

  function handleAdditionalFilesChange(fileList: FileList | null) {
    if (!fileList?.length) return;
    const picked = Array.from(fileList).map((file) => ({ file, isPrimary: false, previewUrl: URL.createObjectURL(file) }));
    setAdditionalImages((prev) => [...prev, ...picked]);
  }

  function removeAdditionalImage(index: number) {
    setAdditionalImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors([]);

    if (!values.title.trim()) {
      setErrors(['Product title is required.']);
      return;
    }

    setIsSubmitting(true);
    try {
      const images = primaryImage ? [primaryImage, ...additionalImages] : additionalImages;
      await onSubmit(
        {
          title: values.title.trim(),
          brand: values.brand.trim() || undefined,
          category: values.category.trim() || undefined,
          shortDescription: values.shortDescription.trim() || undefined,
          description: values.description.trim() || undefined,
          affiliateLink: values.affiliateLink.trim() || undefined,
          editorialFit: values.editorialFit.trim() || undefined,
          notes: values.notes.trim() || undefined,
          isActive: values.isActive,
          // null rather than undefined, so choosing "No thematic area" on an
          // edit actually clears an existing association.
          themeId: values.themeId ? Number(values.themeId) : null,
          // Sent even when blank, so clearing one of these on an edit actually
          // clears it. The server distinguishes an empty string (a deliberate
          // clear) from an absent field (leave what research wrote).
          useCase: values.useCase.trim(),
          problemSolved: values.problemSolved.trim(),
          bestFor: values.bestFor.trim(),
          keyFeatures: values.keyFeatures
            .split('\n')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        },
        images,
      );
    } catch (err) {
      setErrors(err instanceof ApiError ? err.errors : ['Something went wrong. Please try again.']);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="product-form" onSubmit={handleSubmit} noValidate>
      {errors.length > 0 && (
        <div className="form-error" role="alert">
          <ul>
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset>
        <legend>General</legend>
        <label>
          Product Title <span aria-hidden="true">*</span>
          <input value={values.title} onChange={(e) => updateField('title', e.target.value)} required maxLength={200} />
        </label>
        <label>
          Brand
          <input value={values.brand} onChange={(e) => updateField('brand', e.target.value)} />
        </label>
        <label>
          Category
          <input value={values.category} onChange={(e) => updateField('category', e.target.value)} />
        </label>
        <label>
          Thematic Area
          <select value={values.themeId} onChange={(e) => updateField('themeId', e.target.value)}>
            <option value="">No thematic area</option>
            {themes.map((theme) => (
              <option key={theme.id} value={String(theme.id)}>
                {theme.name}
              </option>
            ))}
          </select>
          <span className="product-form__hint">
            Which content area this product belongs to. Optional, and it never stops a product being used in another
            area — it gives the generation step extra context about relevance.
          </span>
        </label>
        <label>
          Short Description
          <textarea rows={2} value={values.shortDescription} onChange={(e) => updateField('shortDescription', e.target.value)} />
        </label>
        <label>
          Full Description
          <textarea rows={4} value={values.description} onChange={(e) => updateField('description', e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Affiliate</legend>
        <label>
          Affiliate Link
          <input value={values.affiliateLink} onChange={(e) => updateField('affiliateLink', e.target.value)} placeholder="https://…" />
        </label>
      </fieldset>

      <fieldset>
        <legend>What it is for</legend>
        <p className="product-form__hint">
          These are the fields the article writer reads. They are what let it place a product where the article is
          already discussing that problem, rather than dropping it in. Product research fills them in automatically
          when it runs; until then, or instead, write them yourself.
        </p>
        <label>
          What it is for
          <textarea
            rows={2}
            value={values.useCase}
            onChange={(e) => updateField('useCase', e.target.value)}
            placeholder="All-day standing at a fixed-height desk"
          />
        </label>
        <label>
          The problem it solves
          <textarea
            rows={2}
            value={values.problemSolved}
            onChange={(e) => updateField('problemSolved', e.target.value)}
            placeholder="Foot and lower-back fatigue from standing on a hard floor"
          />
        </label>
        <label>
          Best for
          <textarea
            rows={2}
            value={values.bestFor}
            onChange={(e) => updateField('bestFor', e.target.value)}
            placeholder="People who already stand most of the day"
          />
        </label>
        <label>
          Key features
          <textarea
            rows={4}
            value={values.keyFeatures}
            onChange={(e) => updateField('keyFeatures', e.target.value)}
            placeholder={'One per line\nSculpted terrain\nPolyurethane foam'}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Editorial</legend>
        <label>
          Why this product fits EveryFiveDays
          <textarea rows={3} value={values.editorialFit} onChange={(e) => updateField('editorialFit', e.target.value)} />
        </label>
        <label>
          Notes
          <textarea rows={3} value={values.notes} onChange={(e) => updateField('notes', e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Status</legend>
        <label className="product-form__checkbox">
          <input type="checkbox" checked={values.isActive} onChange={(e) => updateField('isActive', e.target.checked)} />
          Active
        </label>
      </fieldset>

      {showImagePicker && (
        <fieldset>
          <legend>Media</legend>
          <p className="product-form__hint">
            Optional. Add images now, or add them later from the product's detail page.
          </p>

          <label>
            Primary Image
            <input type="file" accept={ACCEPTED_IMAGE_TYPES} onChange={(e) => handlePrimaryFileChange(e.target.files)} />
          </label>
          {primaryImage && (
            <div className="product-form__preview">
              <img src={primaryImage.previewUrl} alt="Primary preview" />
              <button type="button" className="button button--danger" onClick={() => setPrimaryImage(null)}>
                Remove
              </button>
            </div>
          )}

          <label>
            Additional Images
            <input
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              multiple
              onChange={(e) => handleAdditionalFilesChange(e.target.files)}
            />
          </label>
          {additionalImages.length > 0 && (
            <div className="product-form__preview-grid">
              {additionalImages.map((image, index) => (
                <div className="product-form__preview" key={image.previewUrl}>
                  <img src={image.previewUrl} alt={`Additional preview ${index + 1}`} />
                  <button type="button" className="button button--danger" onClick={() => removeAdditionalImage(index)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <div className="product-form__actions">
        <button type="submit" className="button button--primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
