import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import {
  fetchProduct,
  deleteProduct,
  setProductStatus,
  uploadProductImage,
  setPrimaryImage,
  deleteProductImage,
} from './api';
import type { ProductDetail as ProductDetailType, ProductImage } from '../../shared/types/product';
import { ApiError } from '../../shared/services/apiClient';
import './ProductDetail.css';

const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="product-detail__field">
      <dt>{label}</dt>
      <dd>{value?.trim() ? value : <span className="product-detail__empty">Not set</span>}</dd>
    </div>
  );
}

export function ProductDetail() {
  const { id } = useParams();
  const productId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();

  const [product, setProduct] = useState<ProductDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>((location.state as { flash?: string } | null)?.flash ?? null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busyImageId, setBusyImageId] = useState<number | 'new' | null>(null);

  const addImageInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replacingImageId = useRef<number | null>(null);

  function load() {
    setIsLoading(true);
    fetchProduct(productId)
      .then(setProduct)
      .catch(() => setError('Product not found.'))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
  }, [productId]);

  async function handleToggleStatus() {
    if (!product) return;
    const updated = await setProductStatus(product.id, !product.isActive);
    setProduct((prev) => (prev ? { ...prev, isActive: updated.isActive, updatedAt: updated.updatedAt } : prev));
  }

  async function handleDelete() {
    if (!product) return;
    if (!window.confirm(`Delete ${product.title}? This also deletes its images.`)) return;
    await deleteProduct(product.id);
    navigate('/products', { state: { flash: `${product.title} was deleted.` } });
  }

  async function handleAddImage(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || !product) return;
    setImageError(null);
    setBusyImageId('new');
    try {
      const image = await uploadProductImage(product.id, file, product.images.length === 0);
      setProduct((prev) => (prev ? { ...prev, images: mergeAsPrimaryAware(prev.images, image) } : prev));
    } catch (err) {
      setImageError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to upload image.');
    } finally {
      setBusyImageId(null);
      if (addImageInputRef.current) addImageInputRef.current.value = '';
    }
  }

  function startReplace(imageId: number) {
    replacingImageId.current = imageId;
    replaceInputRef.current?.click();
  }

  async function handleReplaceFileChosen(fileList: FileList | null) {
    const file = fileList?.[0];
    const oldImageId = replacingImageId.current;
    if (!file || !product || oldImageId === null) return;

    setImageError(null);
    setBusyImageId(oldImageId);
    try {
      const oldImage = product.images.find((img) => img.id === oldImageId);
      const newImage = await uploadProductImage(product.id, file, oldImage?.isPrimary ?? false);
      await deleteProductImage(product.id, oldImageId);
      setProduct((prev) =>
        prev ? { ...prev, images: [...prev.images.filter((img) => img.id !== oldImageId), newImage] } : prev,
      );
    } catch (err) {
      setImageError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to replace image.');
    } finally {
      setBusyImageId(null);
      replacingImageId.current = null;
      if (replaceInputRef.current) replaceInputRef.current.value = '';
    }
  }

  async function handleSetPrimary(imageId: number) {
    if (!product) return;
    setBusyImageId(imageId);
    try {
      await setPrimaryImage(product.id, imageId);
      setProduct((prev) =>
        prev
          ? { ...prev, images: prev.images.map((img) => ({ ...img, isPrimary: img.id === imageId })) }
          : prev,
      );
    } catch (err) {
      setImageError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to set primary image.');
    } finally {
      setBusyImageId(null);
    }
  }

  async function handleRemoveImage(imageId: number) {
    if (!product) return;
    if (!window.confirm('Remove this image?')) return;
    setBusyImageId(imageId);
    try {
      await deleteProductImage(product.id, imageId);
      load(); // reload so any auto-promoted primary image is reflected
    } catch (err) {
      setImageError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to remove image.');
      setBusyImageId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="page">
        <p>Loading…</p>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="page">
        <PageHeader title="Product not found" description="This product may have been deleted." />
        <Link to="/products">Back to Products</Link>
      </div>
    );
  }

  const sortedImages = [...product.images].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) || a.position - b.position);

  return (
    <div className="page">
      {flash && (
        <div className="flash-banner" role="status">
          {flash}
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="product-detail__header">
        <PageHeader title={product.title} description={[product.brand, product.category].filter(Boolean).join(' · ') || 'No brand or category set'} />
        <div className="product-detail__actions">
          <span className={`status-badge ${product.isActive ? 'is-active' : 'is-inactive'}`}>
            {product.isActive ? 'Active' : 'Inactive'}
          </span>
          <button type="button" className="button" onClick={handleToggleStatus}>
            {product.isActive ? 'Deactivate' : 'Activate'}
          </button>
          <Link to={`/products/${product.id}/edit`} className="button">
            Edit
          </Link>
          <button type="button" className="button button--danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>

      <section className="product-detail__section">
        <h2>General</h2>
        <dl>
          <Field label="Thematic Area" value={product.themeName} />
          <Field label="Short Description" value={product.shortDescription} />
          <Field label="Full Description" value={product.description} />
        </dl>
      </section>

      <section className="product-detail__section">
        <h2>Affiliate</h2>
        <dl>
          <Field label="Affiliate Link" value={product.affiliateLink} />
        </dl>
      </section>

      <section className="product-detail__section">
        <h2>Editorial</h2>
        <dl>
          <Field label="Why this product fits EveryFiveDays" value={product.editorialFit} />
          <Field label="Notes" value={product.notes} />
        </dl>
      </section>

      <section className="product-detail__section">
        <div className="product-detail__media-header">
          <h2>Media</h2>
          <label className="button">
            {busyImageId === 'new' ? 'Uploading…' : 'Upload Image'}
            <input
              ref={addImageInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              className="product-detail__hidden-input"
              onChange={(e) => handleAddImage(e.target.files)}
              disabled={busyImageId !== null}
            />
          </label>
        </div>

        <input
          ref={replaceInputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES}
          className="product-detail__hidden-input"
          onChange={(e) => handleReplaceFileChosen(e.target.files)}
        />

        {imageError && (
          <p className="form-error" role="alert">
            {imageError}
          </p>
        )}

        {sortedImages.length === 0 ? (
          <p>No images yet.</p>
        ) : (
          <div className="product-detail__gallery">
            {sortedImages.map((image) => (
              <ImageCard
                key={image.id}
                image={image}
                busy={busyImageId === image.id}
                onSetPrimary={() => handleSetPrimary(image.id)}
                onReplace={() => startReplace(image.id)}
                onRemove={() => handleRemoveImage(image.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ImageCard({
  image,
  busy,
  onSetPrimary,
  onReplace,
  onRemove,
}: {
  image: ProductImage;
  busy: boolean;
  onSetPrimary: () => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="product-detail__image-card">
      <img src={image.url} alt={image.originalFilename ?? 'Product image'} />
      {image.isPrimary && <span className="status-badge is-active product-detail__primary-badge">Primary</span>}
      <div className="product-detail__image-actions">
        {!image.isPrimary && (
          <button type="button" className="button" onClick={onSetPrimary} disabled={busy}>
            Set as Primary
          </button>
        )}
        <button type="button" className="button" onClick={onReplace} disabled={busy}>
          Replace
        </button>
        <button type="button" className="button button--danger" onClick={onRemove} disabled={busy}>
          Remove
        </button>
      </div>
    </div>
  );
}

function mergeAsPrimaryAware(images: ProductImage[], newImage: ProductImage): ProductImage[] {
  if (!newImage.isPrimary) return [...images, newImage];
  return [...images.map((img) => ({ ...img, isPrimary: false })), newImage];
}
