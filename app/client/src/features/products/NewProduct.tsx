import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ProductForm } from './ProductForm';
import { createProduct, uploadProductImage } from './api';

export function NewProduct() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <PageHeader title="New Product" description="Add a product to Cynth's library for future articles to reference." />
      <ProductForm
        submitLabel="Create Product"
        showImagePicker
        onSubmit={async (input, images) => {
          const product = await createProduct(input);
          // Images require the product to exist first (they're stored via a
          // separate multipart endpoint) — upload in order so position/primary
          // flags land the way the user picked them.
          for (const image of images) {
            await uploadProductImage(product.id, image.file, image.isPrimary);
          }
          navigate(`/products/${product.id}`, { state: { flash: `${product.title} was created.` } });
        }}
      />
    </div>
  );
}
