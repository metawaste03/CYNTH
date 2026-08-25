import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ProductForm } from './ProductForm';
import { fetchProduct, updateProduct } from './api';
import type { ProductDetail } from '../../shared/types/product';

export function EditProduct() {
  const { id } = useParams();
  const navigate = useNavigate();
  const productId = Number(id);

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    fetchProduct(productId)
      .then(setProduct)
      .catch(() => setError('Product not found.'))
      .finally(() => setIsLoading(false));
  }, [productId]);

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

  return (
    <div className="page">
      <PageHeader title={`Edit ${product.title}`} description="Update this product's details. Images are managed from the detail page." />
      <ProductForm
        submitLabel="Save Changes"
        initialValues={{
          title: product.title,
          brand: product.brand ?? '',
          category: product.category ?? '',
          shortDescription: product.shortDescription ?? '',
          description: product.description ?? '',
          affiliateLink: product.affiliateLink ?? '',
          editorialFit: product.editorialFit ?? '',
          notes: product.notes ?? '',
          isActive: product.isActive,
        }}
        onSubmit={async (input) => {
          const updated = await updateProduct(productId, input);
          navigate(`/products/${updated.id}`, { state: { flash: 'Changes saved.' } });
        }}
      />
    </div>
  );
}
