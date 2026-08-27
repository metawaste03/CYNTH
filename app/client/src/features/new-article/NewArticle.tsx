import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ArticleTypeCard } from './ArticleTypeCard';
import { AuthorPicker } from './AuthorPicker';
import { ProductPicker } from './ProductPicker';
import { ContentBriefFields } from './ContentBriefFields';
import { EditorialReviewSummary } from './EditorialReviewSummary';
import { ComingSoonButton } from './ComingSoonButton';
import { GenerateArticlePanel } from './GenerateArticlePanel';
import { StepIndicator, STEP_LABELS } from './StepIndicator';
import { fetchArticleTypes, fetchArticleDraft, createArticleDraft, updateArticleDraft } from './api';
import { fetchAuthor } from '../authors/api';
import { fetchProjects, fetchThemes, fetchTheme } from '../content/api';
import type { Theme, Topic } from '../../shared/types/content';
import { fetchProduct } from '../products/api';
import type { ArticleType } from '../../shared/types/articleType';
import type { ArticleDraftInput } from '../../shared/types/article';
import type { Author } from '../../shared/types/author';
import type { ProductDetail } from '../../shared/types/product';
import { ApiError } from '../../shared/services/apiClient';
import './NewArticle.css';

interface WizardFields {
  articleTypeId: number | null;
  authorId: number | null;
  projectId: number | null;
  themeId: number | null;
  topicId: number | null;
  productId: number | null;
  topic: string;
  title: string;
  primaryKeyword: string;
  secondaryKeywords: string;
  targetAudience: string;
  searchIntent: string;
  readerPainPoints: string;
  questionsToAnswer: string;
  importantTopics: string;
  notes: string;
}

const EMPTY_FIELDS: WizardFields = {
  articleTypeId: null,
  authorId: null,
  projectId: null,
  themeId: null,
  topicId: null,
  productId: null,
  topic: '',
  title: '',
  primaryKeyword: '',
  secondaryKeywords: '',
  targetAudience: '',
  searchIntent: '',
  readerPainPoints: '',
  questionsToAnswer: '',
  importantTopics: '',
  notes: '',
};

const LAST_STEP = STEP_LABELS.length;

export function NewArticle() {
  const { id } = useParams();
  const draftId = id ? Number(id) : null;
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState(1);
  const [fields, setFields] = useState<WizardFields>(EMPTY_FIELDS);
  const [articleTypes, setArticleTypes] = useState<ArticleType[]>([]);
  const [authorDetail, setAuthorDetail] = useState<Author | null>(null);
  const [productDetail, setProductDetail] = useState<ProductDetail | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Load article types always, and the existing draft's fields if reopening one.
  useEffect(() => {
    setIsLoading(true);
    setLoadError(null);
    setNotFound(false);
    setStep(1);
    setSaveMessage((location.state as { justSaved?: boolean } | null)?.justSaved ? 'Draft saved.' : null);

    const loadTypes = fetchArticleTypes();
    const loadDraft = draftId ? fetchArticleDraft(draftId) : Promise.resolve(null);

    Promise.all([loadTypes, loadDraft])
      .then(([types, draft]) => {
        setArticleTypes(types);
        if (draft) {
          setFields({
            articleTypeId: draft.articleTypeId,
            authorId: draft.authorId,
            projectId: draft.projectId ?? null,
            themeId: draft.themeId ?? null,
            topicId: draft.topicId ?? null,
            productId: draft.productId,
            topic: draft.topic ?? '',
            title: draft.title ?? '',
            primaryKeyword: draft.keywords?.primaryKeyword ?? '',
            secondaryKeywords: draft.keywords?.secondaryKeywords ?? '',
            targetAudience: draft.targetAudience ?? '',
            searchIntent: draft.searchIntent ?? '',
            readerPainPoints: draft.readerPainPoints ?? '',
            questionsToAnswer: draft.questionsToAnswer ?? '',
            importantTopics: draft.importantTopics ?? '',
            notes: draft.notes ?? '',
          });
        } else {
          setFields(EMPTY_FIELDS);
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load the New Article workflow.');
        }
      })
      .finally(() => setIsLoading(false));
  }, [draftId]);

  // ---- Content configuration: Project -> Theme -> Topic -> Author ----------
  // The dropdowns below are a convenience. The backend independently rejects
  // a topic from the wrong thematic area or an author who does not cover it.
  const [themes, setThemes] = useState<Theme[]>([]);
  const [themeTopics, setThemeTopics] = useState<Topic[]>([]);
  const [themeAuthorIds, setThemeAuthorIds] = useState<number[] | null>(null);

  // The default project is adopted automatically - Cynth has one content
  // universe today, and asking the user to pick it would be noise.
  useEffect(() => {
    fetchProjects()
      .then((r) => {
        if (!r.default) return;
        const defaultProject = r.default;
        setFields((current) => (current.projectId ? current : { ...current, projectId: defaultProject.id }));
        return fetchThemes({ projectId: defaultProject.id, activeOnly: true }).then(setThemes);
      })
      .catch(() => setThemes([]));
  }, []);

  // Selecting a thematic area determines which topics and authors are offered.
  useEffect(() => {
    if (fields.themeId === null) {
      setThemeTopics([]);
      setThemeAuthorIds(null);
      return;
    }
    fetchTheme(fields.themeId)
      .then((detail) => {
        setThemeTopics(detail.topics.filter((t) => t.isActive));
        // No authors configured for an area means "no restriction", matching
        // the backend rule rather than silently offering nobody.
        setThemeAuthorIds(detail.authors.length ? detail.authors.map((a) => a.id) : null);
      })
      .catch(() => {
        setThemeTopics([]);
        setThemeAuthorIds(null);
      });
  }, [fields.themeId]);

  // Keep the read-only author detail (for step 2 and the review) in sync with the selection.
  useEffect(() => {
    if (fields.authorId === null) {
      setAuthorDetail(null);
      return;
    }
    fetchAuthor(fields.authorId)
      .then(setAuthorDetail)
      .catch(() => setAuthorDetail(null));
  }, [fields.authorId]);

  // Same for the product summary used on the review screen.
  useEffect(() => {
    if (fields.productId === null) {
      setProductDetail(null);
      return;
    }
    fetchProduct(fields.productId)
      .then(setProductDetail)
      .catch(() => setProductDetail(null));
  }, [fields.productId]);

  function updateField<K extends keyof WizardFields>(key: K, value: WizardFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function goToStep(target: number) {
    setStep(Math.min(Math.max(target, 1), LAST_STEP));
  }

  async function handleSaveDraft() {
    if (fields.articleTypeId === null) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    const input: ArticleDraftInput = {
      articleTypeId: fields.articleTypeId,
      authorId: fields.authorId,
      productId: fields.productId,
      projectId: fields.projectId,
      themeId: fields.themeId,
      topicId: fields.topicId,
      topic: fields.topic,
      title: fields.title,
      targetAudience: fields.targetAudience,
      searchIntent: fields.searchIntent,
      readerPainPoints: fields.readerPainPoints,
      questionsToAnswer: fields.questionsToAnswer,
      importantTopics: fields.importantTopics,
      notes: fields.notes,
      primaryKeyword: fields.primaryKeyword,
      secondaryKeywords: fields.secondaryKeywords,
    };

    try {
      if (draftId) {
        await updateArticleDraft(draftId, input);
        setSaveMessage('Draft saved.');
      } else {
        const draft = await createArticleDraft(input);
        // Reflect the draft in the URL so reopening it later reloads every field.
        navigate(`/new-article/${draft.id}`, { replace: true, state: { justSaved: true } });
      }
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to save draft.');
    } finally {
      setIsSaving(false);
    }
  }

  if (notFound) {
    return (
      <div className="page">
        <PageHeader title="Draft not found" description="This article draft may have been removed." />
      </div>
    );
  }

  const canGoNext =
    (step !== 1 || fields.articleTypeId !== null) &&
    (step !== 3 || fields.topic.trim() !== '') &&
    (step !== 4 || fields.title.trim() !== '');

  const selectedArticleType = articleTypes.find((t) => t.id === fields.articleTypeId) ?? null;

  return (
    <div className="page">
      <PageHeader
        title="New Article"
        description="Walk through the Content Brief, then generate a first draft at the Editorial Review step. Everything you enter here is saved and fed to the configured model — and every generated draft stays unpublished until you approve it."
      />

      {isLoading ? (
        <p>Loading…</p>
      ) : loadError ? (
        <p className="form-error" role="alert">
          {loadError}
        </p>
      ) : (
        <>
          <StepIndicator currentStep={step} />

          {saveError && (
            <p className="form-error" role="alert">
              {saveError}
            </p>
          )}
          {saveMessage && (
            <p className="new-article__save-message" role="status">
              {saveMessage}
            </p>
          )}

          <div className="wizard-step">
            {step === 1 && (
              <>
                <h2>1. Article Type</h2>
                <div className="new-article__types-grid" role="radiogroup" aria-label="Article Types">
                  {articleTypes.map((type) => (
                    <ArticleTypeCard
                      key={type.id}
                      type={type}
                      isSelected={fields.articleTypeId === type.id}
                      onSelect={() => updateField('articleTypeId', type.id)}
                    />
                  ))}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2>2. Thematic Area &amp; Author</h2>
                <label className="wizard-field">
                  Thematic Area
                  <select
                    value={fields.themeId ?? ''}
                    onChange={(e) => {
                      const themeId = e.target.value ? Number(e.target.value) : null;
                      // Changing the area invalidates a topic chosen under the
                      // previous one, so clear it rather than send a mismatch.
                      setFields((current) => ({ ...current, themeId, topicId: null }));
                    }}
                  >
                    <option value="">No thematic area</option>
                    {themes.map((theme) => (
                      <option key={theme.id} value={theme.id}>
                        {theme.name}
                      </option>
                    ))}
                  </select>
                </label>
                {themes.length === 0 && (
                  <p className="wizard-hint">
                    No thematic areas configured yet. <Link to="/content/themes">Add one</Link> to group topics and
                    authors.
                  </p>
                )}
                <AuthorPicker
                  selectedAuthorId={fields.authorId}
                  onSelect={(authorId) => updateField('authorId', authorId)}
                  allowedAuthorIds={themeAuthorIds}
                />
                {authorDetail && (
                  <dl className="author-detail-readonly">
                    <div>
                      <dt>Name</dt>
                      <dd>{authorDetail.name}</dd>
                    </div>
                    <div>
                      <dt>Category</dt>
                      <dd>{authorDetail.category || '—'}</dd>
                    </div>
                    <div>
                      <dt>Philosophy</dt>
                      <dd>{authorDetail.philosophy || '—'}</dd>
                    </div>
                    <div>
                      <dt>Writing Style</dt>
                      <dd>{authorDetail.writingStyle || '—'}</dd>
                    </div>
                  </dl>
                )}
              </>
            )}

            {step === 3 && (
              <>
                <h2>3. Topic</h2>
                {fields.themeId === null ? (
                  <p className="wizard-hint">
                    Pick a thematic area on the previous step to choose from its topics, or type a subject below.
                  </p>
                ) : themeTopics.length === 0 ? (
                  <p className="wizard-hint">
                    This thematic area has no topics yet.{' '}
                    <Link to={`/content/themes/${fields.themeId}`}>Add one</Link> to carry editorial guidance into
                    generation, or type a subject below.
                  </p>
                ) : (
                  <label className="wizard-field">
                    Topic
                    <select
                      value={fields.topicId ?? ''}
                      onChange={(e) => {
                        const topicId = e.target.value ? Number(e.target.value) : null;
                        const chosen = themeTopics.find((t) => t.id === topicId);
                        // Mirror the chosen topic into the free-text field so
                        // the prompt still reads naturally and older drafts
                        // keep working.
                        setFields((current) => ({
                          ...current,
                          topicId,
                          topic: chosen ? chosen.title : current.topic,
                        }));
                      }}
                    >
                      <option value="">No topic selected</option>
                      {themeTopics.map((topic) => (
                        <option key={topic.id} value={topic.id}>
                          {topic.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="wizard-field">
                  Main Topic <span aria-hidden="true">*</span>
                  <input value={fields.topic} onChange={(e) => updateField('topic', e.target.value)} required />
                </label>
              </>
            )}

            {step === 4 && (
              <>
                <h2>4. Working Title</h2>
                <label className="wizard-field">
                  Working Title <span aria-hidden="true">*</span>
                  <input value={fields.title} onChange={(e) => updateField('title', e.target.value)} required />
                </label>
                <ComingSoonButton label="Generate Title" />
              </>
            )}

            {step === 5 && (
              <>
                <h2>5. Keywords</h2>
                <label className="wizard-field">
                  Primary Keyword
                  <input value={fields.primaryKeyword} onChange={(e) => updateField('primaryKeyword', e.target.value)} />
                </label>
                <label className="wizard-field">
                  Secondary Keywords
                  <textarea
                    rows={2}
                    value={fields.secondaryKeywords}
                    onChange={(e) => updateField('secondaryKeywords', e.target.value)}
                    placeholder="Separate with commas"
                  />
                </label>
                <ComingSoonButton label="Generate Long-tail Keywords" />
              </>
            )}

            {step === 6 && (
              <>
                <h2>6. Product</h2>
                <ProductPicker
                  selectedProductId={fields.productId}
                  onSelect={(productId) => updateField('productId', productId)}
                />
              </>
            )}

            {step === 7 && (
              <>
                <h2>7. Content Brief</h2>
                <ContentBriefFields
                  values={{
                    targetAudience: fields.targetAudience,
                    searchIntent: fields.searchIntent,
                    readerPainPoints: fields.readerPainPoints,
                    questionsToAnswer: fields.questionsToAnswer,
                    importantTopics: fields.importantTopics,
                    notes: fields.notes,
                  }}
                  onChange={(field, value) => updateField(field, value)}
                />
              </>
            )}

            {step === 8 && (
              <>
                <h2>8. Editorial Review</h2>
                {draftId ? (
                  <p>
                    <Link to={`/new-article/${draftId}/prompt`} className="button">
                      Preview Prompt
                    </Link>
                  </p>
                ) : (
                  <p className="new-article__save-message">Save this draft to preview its assembled prompt.</p>
                )}
                <EditorialReviewSummary
                  articleTypeName={selectedArticleType?.name ?? null}
                  authorName={authorDetail?.name ?? null}
                  topic={fields.topic}
                  title={fields.title}
                  primaryKeyword={fields.primaryKeyword}
                  secondaryKeywords={fields.secondaryKeywords}
                  productName={productDetail?.title ?? null}
                  productBrand={productDetail?.brand ?? null}
                  brief={{
                    targetAudience: fields.targetAudience,
                    searchIntent: fields.searchIntent,
                    readerPainPoints: fields.readerPainPoints,
                    questionsToAnswer: fields.questionsToAnswer,
                    importantTopics: fields.importantTopics,
                    notes: fields.notes,
                  }}
                  onEdit={goToStep}
                />

                {/* Generation runs against the *saved* draft, so unsaved edits
                    above are deliberately not sent — save first. */}
                {draftId && <GenerateArticlePanel draftId={draftId} workingTitle={fields.title} />}
              </>
            )}
          </div>

          <div className="wizard-nav">
            <button type="button" className="button" onClick={() => goToStep(step - 1)} disabled={step === 1}>
              Back
            </button>
            <button type="button" className="button button--primary" onClick={handleSaveDraft} disabled={fields.articleTypeId === null || isSaving}>
              {isSaving ? 'Saving…' : 'Save Draft'}
            </button>
            {step < LAST_STEP && (
              <button type="button" className="button" onClick={() => goToStep(step + 1)} disabled={!canGoNext}>
                Next
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
