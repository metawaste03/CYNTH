import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  CheckpointKind,
  KeywordOptions,
  OpenCheckpoint,
  ProductOption,
  ProductOpportunity,
  ProductOptions,
  ReviewOptions,
  TemplateOptions,
  TopicOptions,
} from './api';

/**
 * THE DECISION PANE.
 *
 * One component for all four checkpoints, because they are the same shape of
 * question: here is what Cynth produced, here is what it recommends, choose or
 * override.
 *
 * Three things are deliberate throughout:
 *
 *   1. The recommendation is always pre-selected and always labelled as such,
 *      so "just go with it" is one click and is never disguised as a
 *      considered choice.
 *   2. Asking for different options is separated from choosing, and says that
 *      it costs money, because it re-runs a paid stage.
 *   3. Nothing here writes to the article. It sends a decision; the server
 *      decides what that decision means.
 */

interface CheckpointPanelProps {
  checkpoint: OpenCheckpoint;
  busy: boolean;
  onDecide: (decision: unknown, accepted: boolean) => void;
  onRerun: () => void;
  onSkipAll: () => void;
  /** Re-reads the checkpoint, so a product added in another tab appears here. */
  onRefresh: () => void;
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/* --------------------------------------------------------------- topic --- */

function TopicChoice({ options, busy, onDecide }: { options: TopicOptions; busy: boolean; onDecide: CheckpointPanelProps['onDecide'] }) {
  const [selected, setSelected] = useState(options.recommendedIndex);
  const [custom, setCustom] = useState('');
  const [useCustom, setUseCustom] = useState(false);

  return (
    <>
      <ul className="checkpoint-options">
        {options.candidates.map((candidate) => (
          <li key={candidate.index} className={`checkpoint-option ${selected === candidate.index && !useCustom ? 'is-selected' : ''}`}>
            <label>
              <input
                type="radio"
                name="topic"
                checked={selected === candidate.index && !useCustom}
                onChange={() => {
                  setSelected(candidate.index);
                  setUseCustom(false);
                }}
              />
              <span className="checkpoint-option__title">
                {candidate.topic}
                {candidate.index === options.recommendedIndex && (
                  <span className="checkpoint-badge">Cynth recommends</span>
                )}
              </span>
            </label>

            <dl className="checkpoint-option__detail">
              <div>
                <dt>Angle</dt>
                <dd>{candidate.recommendedAngle}</dd>
              </div>
              <div>
                <dt>Reader</dt>
                <dd>{candidate.audience || 'Not stated'}</dd>
              </div>
              <div>
                <dt>Search</dt>
                <dd>{candidate.searchOpportunity || 'Not stated'}</dd>
              </div>
              <div>
                <dt>Commercial</dt>
                <dd>{candidate.commercialOpportunity || 'Not stated'}</dd>
              </div>
              <div>
                <dt>Gap</dt>
                <dd>{candidate.contentGap || 'Not stated'}</dd>
              </div>
            </dl>

            <p className="checkpoint-option__summary">{candidate.researchSummary}</p>
            <p className="pipeline-muted">
              {candidate.sourceCount === 0
                ? 'No sources were captured for this one.'
                : `${candidate.sourceCount} source${candidate.sourceCount === 1 ? '' : 's'} captured.`}
            </p>
          </li>
        ))}
      </ul>

      <label className="checkpoint-custom">
        <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} />
        Write about something else instead
      </label>

      {useCustom && (
        <>
          <input
            className="checkpoint-input"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Your topic"
          />
          {/* Said plainly, because the article will be written from research
              that was done for a different subject. */}
          <p className="checkpoint-warning">
            Cynth has not researched this topic. It will be written without the search, gap and timing findings above,
            and without sources.
          </p>
        </>
      )}

      <div className="checkpoint-actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy || (useCustom && !custom.trim())}
          onClick={() =>
            onDecide(
              useCustom ? { customTopic: custom.trim() } : { index: selected },
              !useCustom && selected === options.recommendedIndex,
            )
          }
        >
          {busy ? 'Saving…' : 'Use this topic'}
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------ keywords/title --- */

function KeywordChoice({ options, busy, onDecide }: { options: KeywordOptions; busy: boolean; onDecide: CheckpointPanelProps['onDecide'] }) {
  const [title, setTitle] = useState(options.recommendedTitle);
  const [customTitle, setCustomTitle] = useState('');
  const [useCustomTitle, setUseCustomTitle] = useState(false);
  const [primary, setPrimary] = useState(options.primaryKeyword);
  const [secondary, setSecondary] = useState(options.secondaryKeywords.join('\n'));
  const [longTail, setLongTail] = useState(options.longTailKeywords.join('\n'));

  const effectiveTitle = useCustomTitle ? customTitle.trim() : title;

  return (
    <>
      <h4 className="checkpoint-subhead">Title</h4>
      <ul className="checkpoint-options checkpoint-options--compact">
        {options.titleCandidates.map((candidate) => (
          <li key={candidate} className={`checkpoint-option ${!useCustomTitle && title === candidate ? 'is-selected' : ''}`}>
            <label>
              <input
                type="radio"
                name="title"
                checked={!useCustomTitle && title === candidate}
                onChange={() => {
                  setTitle(candidate);
                  setUseCustomTitle(false);
                }}
              />
              <span className="checkpoint-option__title">
                {candidate}
                {candidate === options.recommendedTitle && <span className="checkpoint-badge">Cynth recommends</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <label className="checkpoint-custom">
        <input type="checkbox" checked={useCustomTitle} onChange={(e) => setUseCustomTitle(e.target.checked)} />
        Write my own title
      </label>
      {useCustomTitle && (
        <input
          className="checkpoint-input"
          value={customTitle}
          onChange={(e) => setCustomTitle(e.target.value)}
          placeholder="Your title"
        />
      )}

      <h4 className="checkpoint-subhead">Keywords</h4>
      <label className="wizard-field">
        Primary keyword
        <input value={primary} onChange={(e) => setPrimary(e.target.value)} />
      </label>

      <label className="wizard-field">
        Secondary keywords <span className="pipeline-muted">one per line</span>
        <textarea rows={4} value={secondary} onChange={(e) => setSecondary(e.target.value)} />
      </label>

      <label className="wizard-field">
        Long-tail keywords <span className="pipeline-muted">one per line</span>
        <textarea rows={4} value={longTail} onChange={(e) => setLongTail(e.target.value)} />
      </label>

      {/* Research the writer still gets, whatever is edited above. Shown so
          that deleting a keyword does not look like deleting the context. */}
      {(options.entities.length > 0 || options.relatedQuestions.length > 0) && (
        <div className="checkpoint-context">
          <h4 className="checkpoint-subhead">Also passed to the writer</h4>
          {options.entities.length > 0 && (
            <p>
              <strong>Entities:</strong> {options.entities.join(', ')}
            </p>
          )}
          {options.relatedQuestions.length > 0 && (
            <p>
              <strong>Questions readers ask:</strong> {options.relatedQuestions.join(' · ')}
            </p>
          )}
          {options.seoNotes.length > 0 && (
            <p>
              <strong>SEO notes:</strong> {options.seoNotes.join(' · ')}
            </p>
          )}
        </div>
      )}

      <div className="checkpoint-actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy || !effectiveTitle || !primary.trim()}
          onClick={() =>
            onDecide(
              {
                title: effectiveTitle,
                primaryKeyword: primary.trim(),
                secondaryKeywords: splitList(secondary),
                longTailKeywords: splitList(longTail),
              },
              !useCustomTitle &&
                title === options.recommendedTitle &&
                primary.trim() === options.primaryKeyword &&
                secondary === options.secondaryKeywords.join('\n') &&
                longTail === options.longTailKeywords.join('\n'),
            )
          }
        >
          {busy ? 'Saving…' : 'Use this title and keywords'}
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ template --- */

function TemplateChoice({ options, busy, onDecide }: { options: TemplateOptions; busy: boolean; onDecide: CheckpointPanelProps['onDecide'] }) {
  const [type, setType] = useState(options.articleType);

  return (
    <>
      <p className="checkpoint-lead">
        Cynth classified this as <strong>{options.articleType}</strong> ({Math.round(options.confidence * 100)}%
        confident) and will write it to the <strong>{options.templateName}</strong> template.
      </p>
      <p className="checkpoint-option__summary">{options.reasoning}</p>

      {options.borrowed && (
        <p className="checkpoint-warning">
          No template is registered for this type, so a near neighbour is being used.
        </p>
      )}

      <p className="pipeline-muted">Sections: {options.sectionKeys.join(' → ')}</p>

      <label className="wizard-field">
        Article type
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {options.availableTypes.map((slug) => (
            <option key={slug} value={slug}>
              {slug}
              {slug === options.articleType ? ' — Cynth chose this' : ''}
            </option>
          ))}
        </select>
      </label>

      <div className="checkpoint-actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() =>
            onDecide({ articleType: type === options.articleType ? null : type }, type === options.articleType)
          }
        >
          {busy ? 'Saving…' : type === options.articleType ? 'Keep this type' : `Write it as a ${type}`}
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ products --- */

function ProductRow({
  product,
  checked,
  onToggle,
}: {
  product: ProductOption;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={`checkpoint-option product-row ${checked ? 'is-selected' : ''}`}>
      <label>
        <input type="checkbox" checked={checked} onChange={onToggle} />
        {product.imageUrl && <img className="product-row__image" src={`/${product.imageUrl}`} alt="" />}
        <span className="checkpoint-option__title">
          {product.title}
          {product.brand && <span className="pipeline-muted"> · {product.brand}</span>}
          {product.themeName && !product.matchesTheme && (
            <span className="checkpoint-badge">{product.themeName}</span>
          )}
        </span>
      </label>

      {(product.useCase || product.problemSolved) && (
        <dl className="checkpoint-option__detail">
          {product.useCase && (
            <div>
              <dt>For</dt>
              <dd>{product.useCase}</dd>
            </div>
          )}
          {product.problemSolved && (
            <div>
              <dt>Solves</dt>
              <dd>{product.problemSolved}</dd>
            </div>
          )}
        </dl>
      )}

      {/* Said before the choice rather than discovered in the finished draft:
          a product with nothing recorded about its purpose can only be placed
          decoratively. */}
      {product.readinessNote && <p className="checkpoint-warning">{product.readinessNote}</p>}
    </li>
  );
}

/**
 * The shopping brief.
 *
 * Deliberately above the library list: the point of this checkpoint is not
 * only "which of these do I have" but "what should I go and find". Categories,
 * never named products — see productOpportunity.service.ts for why.
 */
function OpportunityBrief({ opportunities, assessment }: { opportunities: ProductOpportunity[]; assessment: string | null }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(term: string) {
    try {
      await navigator.clipboard.writeText(term);
      setCopied(term);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard access can be refused. The term is on screen either way.
    }
  }

  if (opportunities.length === 0) {
    return assessment ? (
      <div className="checkpoint-context">
        <h4 className="checkpoint-subhead">What this article could recommend</h4>
        <p>{assessment}</p>
      </div>
    ) : null;
  }

  return (
    <div className="opportunity-brief">
      <h4 className="checkpoint-subhead">What to look for</h4>
      {assessment && <p className="checkpoint-option__summary">{assessment}</p>}

      <ul className="opportunity-list">
        {opportunities.map((opportunity) => (
          <li key={opportunity.productType} className={`opportunity opportunity--${opportunity.priority}`}>
            <div className="opportunity__head">
              <strong>{opportunity.productType}</strong>
              <span className="opportunity__priority">{opportunity.priority}</span>
              {opportunity.sectionKey && <span className="pipeline-muted">for {opportunity.sectionKey}</span>}
            </div>
            <p className="opportunity__why">{opportunity.whySuited}</p>
            {opportunity.searchTerms.length > 0 && (
              <p className="opportunity__terms">
                {opportunity.searchTerms.map((term) => (
                  <button
                    key={term}
                    type="button"
                    className="opportunity__term"
                    onClick={() => copy(term)}
                    title="Copy this search term"
                  >
                    {copied === term ? 'Copied' : term}
                  </button>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>

      {/* Said once, plainly: these are categories to shop for, not products
          Cynth believes exist. */}
      <p className="pipeline-muted">
        These are kinds of product, not specific ones — Cynth does not know what is currently sold, and a named product
        it invented would be worse than none. Find real ones, add them on the Product page, then come back and refresh.
      </p>
    </div>
  );
}

function ProductChoice({
  options,
  busy,
  onDecide,
  onRefresh,
}: {
  options: ProductOptions;
  busy: boolean;
  onDecide: CheckpointPanelProps['onDecide'];
  onRefresh: () => void;
}) {
  const [selected, setSelected] = useState<number[]>(options.attachedProductIds);
  const [showOthers, setShowOthers] = useState(options.inTheme.length === 0);

  function toggle(productId: number) {
    setSelected((current) =>
      current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId],
    );
  }

  const overSlots = options.placementSlots > 0 && selected.length > options.placementSlots;

  return (
    <>
      <OpportunityBrief opportunities={options.opportunities} assessment={options.opportunityAssessment} />

      <h4 className="checkpoint-subhead">What you already have</h4>
      <p className="checkpoint-lead">
        {options.themeId === null
          ? 'This article has no thematic area, so every product is listed.'
          : `Products filed under ${options.themeName ?? 'this area'}.`}{' '}
        {options.suggested}
      </p>

      {options.inTheme.length === 0 ? (
        <p className="pipeline-muted">
          {options.themeName
            ? `No products are filed under ${options.themeName} yet.`
            : 'No products are filed yet.'}{' '}
          Add one below, or choose from everything else.
        </p>
      ) : (
        <ul className="checkpoint-options">
          {options.inTheme.map((product) => (
            <ProductRow
              key={product.productId}
              product={product}
              checked={selected.includes(product.productId)}
              onToggle={() => toggle(product.productId)}
            />
          ))}
        </ul>
      )}

      {options.others.length > 0 && (
        <>
          <label className="checkpoint-custom">
            <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} />
            Also show the {options.others.length} product{options.others.length === 1 ? '' : 's'} filed elsewhere
          </label>

          {showOthers && (
            <ul className="checkpoint-options">
              {options.others.map((product) => (
                <ProductRow
                  key={product.productId}
                  product={product}
                  checked={selected.includes(product.productId)}
                  onToggle={() => toggle(product.productId)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {/* Opens in a new tab on purpose. The run is persisted, but sending
          someone away mid-decision to fill in a form and then find their way
          back is a worse experience than two tabs. */}
      <div className="checkpoint-actions">
        <a className="button" href="/products/new" target="_blank" rel="noreferrer">
          Add a product
        </a>
        <button type="button" className="button" disabled={busy} onClick={onRefresh}>
          Refresh the list
        </button>
        <Link className="button button--quiet" to="/products" target="_blank">
          Open the product library
        </Link>
      </div>

      <p className="pipeline-muted">
        Fill in <strong>What it is for</strong> and <strong>The problem it solves</strong> on the product. Those two
        fields are what let the writer place it where the article is already discussing that problem, instead of
        dropping it in.
      </p>

      {overSlots && (
        <p className="checkpoint-warning">
          You have chosen {selected.length}, and this article type has {options.placementSlots} place
          {options.placementSlots === 1 ? '' : 's'} for a product. The writer is told to leave a product out rather
          than force it, so some may not appear.
        </p>
      )}

      <div className="checkpoint-actions">
        <button
          type="button"
          className="button button--primary"
          disabled={busy}
          onClick={() => onDecide({ productIds: selected }, selected.length === 0)}
        >
          {busy
            ? 'Saving…'
            : selected.length === 0
              ? 'Write it without products'
              : `Use ${selected.length} product${selected.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </>
  );
}

/* -------------------------------------------------------------- review --- */

function ReviewChoice({ options, busy, onDecide }: { options: ReviewOptions; busy: boolean; onDecide: CheckpointPanelProps['onDecide'] }) {
  const noRevisionsLeft = options.revisionsRemaining <= 0;

  return (
    <>
      <p className="checkpoint-lead">
        The reviewer scored this <strong>{options.overallScore}</strong>
        {options.revisionRequired ? ' and asked for a revision.' : ' and did not ask for a revision.'}
      </p>
      <p className="checkpoint-option__summary">{options.summary}</p>

      {options.strengths.length > 0 && (
        <div className="checkpoint-context">
          <h4 className="checkpoint-subhead">What works</h4>
          <ul>
            {options.strengths.map((strength) => (
              <li key={strength}>{strength}</li>
            ))}
          </ul>
        </div>
      )}

      {options.issues.length > 0 && (
        <div className="checkpoint-context">
          <h4 className="checkpoint-subhead">What the revision would change</h4>
          <ul>
            {options.issues.map((issue, index) => (
              <li key={`${issue.section}-${index}`}>
                <strong>{issue.severity}</strong> · {issue.section} — {issue.problem}{' '}
                <em>{issue.requiredChange}</em>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The cap, stated where the decision is made rather than in a footnote. */}
      <p className="pipeline-muted">
        {noRevisionsLeft
          ? 'The one revision on this run has already been used. There is no second.'
          : 'Cynth performs at most one revision per run. Choosing it here uses it.'}
      </p>

      <div className="checkpoint-actions">
        <button type="button" className="button" disabled={busy} onClick={() => onDecide({ action: 'accept' }, !options.revisionRequired)}>
          Accept the draft as written
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={busy || noRevisionsLeft}
          onClick={() => onDecide({ action: 'revise' }, options.revisionRequired)}
        >
          {busy ? 'Saving…' : 'Apply the revision'}
        </button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- shell --- */

function renderChoice(
  kind: CheckpointKind,
  options: OpenCheckpoint['options'],
  busy: boolean,
  onDecide: CheckpointPanelProps['onDecide'],
  onRefresh: () => void,
) {
  switch (kind) {
    case 'products':
      return (
        <ProductChoice options={options as ProductOptions} busy={busy} onDecide={onDecide} onRefresh={onRefresh} />
      );
    case 'topic':
      return <TopicChoice options={options as TopicOptions} busy={busy} onDecide={onDecide} />;
    case 'keywords_title':
      return <KeywordChoice options={options as KeywordOptions} busy={busy} onDecide={onDecide} />;
    case 'template':
      return <TemplateChoice options={options as TemplateOptions} busy={busy} onDecide={onDecide} />;
    case 'review':
      return <ReviewChoice options={options as ReviewOptions} busy={busy} onDecide={onDecide} />;
    default:
      return null;
  }
}

export function CheckpointPanel({ checkpoint, busy, onDecide, onRerun, onSkipAll, onRefresh }: CheckpointPanelProps) {
  // Remounts the inner form when the question changes, so the previous
  // checkpoint's selections never carry into the next one.
  const [key, setKey] = useState(checkpoint.kind);
  useEffect(() => setKey(checkpoint.kind), [checkpoint.kind]);

  return (
    <section className="content-section checkpoint">
      <div className="content-section__head">
        <h2>{checkpoint.label}</h2>
        <span className="status-badge status-badge--waiting">Waiting for you</span>
      </div>

      <p className="checkpoint-question">{checkpoint.question}</p>

      <div key={key}>{renderChoice(checkpoint.kind, checkpoint.options, busy, onDecide, onRefresh)}</div>

      <div className="checkpoint-footer">
        {checkpoint.rerunnable && (
          <button type="button" className="button button--quiet" disabled={busy} onClick={onRerun}>
            Ask for different options
          </button>
        )}
        <button type="button" className="button button--quiet" disabled={busy} onClick={onSkipAll}>
          Stop asking — finish it for me
        </button>
      </div>

      <p className="pipeline-muted">
        {checkpoint.rerunnable
          ? 'Asking for different options runs that stage again, and is charged again. Finishing without further questions uses Cynth’s recommendation at every remaining step.'
          : 'Finishing without further questions uses Cynth’s recommendation at every remaining step.'}
      </p>
    </section>
  );
}
