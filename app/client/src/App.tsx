import { Route, Routes } from 'react-router-dom';
import { AppShell } from './shared/components/AppShell/AppShell';
import { NotFound } from './shared/components/NotFound/NotFound';
import { Dashboard } from './features/dashboard/Dashboard';
import { NewArticle } from './features/new-article/NewArticle';
import { PromptPreview } from './features/new-article/PromptPreview';
import { AuthorsList } from './features/authors/AuthorsList';
import { AuthorDetail } from './features/authors/AuthorDetail';
import { NewAuthor } from './features/authors/NewAuthor';
import { EditAuthor } from './features/authors/EditAuthor';
import { ProductsList } from './features/products/ProductsList';
import { ProductDetail } from './features/products/ProductDetail';
import { NewProduct } from './features/products/NewProduct';
import { EditProduct } from './features/products/EditProduct';
import { SeoReview } from './features/seo-review/SeoReview';
import { QualityGate } from './features/quality-gate/QualityGate';
import { Settings } from './features/settings/Settings';
import { ThemesPage } from './features/content/ThemesPage';
import { ThemeDetail } from './features/content/ThemeDetail';
import { DraftsPage } from './features/articles/DraftsPage';
import { ArticleView } from './features/articles/ArticleView';
import { AIProvidersList } from './features/ai-providers/AIProvidersList';
import { AIProviderDetail } from './features/ai-providers/AIProviderDetail';
import { NewAIProvider } from './features/ai-providers/NewAIProvider';
import { EditAIProvider } from './features/ai-providers/EditAIProvider';
import { WordPressSettings } from './features/wordpress/WordPressSettings';

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="new-article">
          <Route index element={<NewArticle />} />
          <Route path=":id" element={<NewArticle />} />
          <Route path=":id/prompt" element={<PromptPreview />} />
        </Route>
        <Route path="authors">
          <Route index element={<AuthorsList />} />
          <Route path="new" element={<NewAuthor />} />
          <Route path=":id" element={<AuthorDetail />} />
          <Route path=":id/edit" element={<EditAuthor />} />
        </Route>
        <Route path="products">
          <Route index element={<ProductsList />} />
          <Route path="new" element={<NewProduct />} />
          <Route path=":id" element={<ProductDetail />} />
          <Route path=":id/edit" element={<EditProduct />} />
        </Route>
        <Route path="content/themes" element={<ThemesPage />} />
        <Route path="content/themes/:id" element={<ThemeDetail />} />
        <Route path="drafts" element={<DraftsPage />} />
        <Route path="articles/:id" element={<ArticleView />} />
        <Route path="seo-review" element={<SeoReview />} />
        <Route path="quality-gate" element={<QualityGate />} />
        <Route path="settings">
          <Route index element={<Settings />} />
          <Route path="ai-providers">
            <Route index element={<AIProvidersList />} />
            <Route path="new" element={<NewAIProvider />} />
            <Route path=":id" element={<AIProviderDetail />} />
            <Route path=":id/edit" element={<EditAIProvider />} />
          </Route>
          <Route path="wordpress" element={<WordPressSettings />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default App;
