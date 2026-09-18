import { Link } from 'react-router-dom';
import type {
  ExternalSourceOpportunity,
  ImageSeoRequirement,
  InternalLinkOpportunity,
  SeoDiagnostics,
  StructuredDataOpportunity,
} from '../../shared/types/seo';

/**
 * Opportunities and diagnostics.
 *
 * The three claims this section is careful never to overstate:
 *
 *   - An internal link points at an article Cynth actually holds, and says
 *     whether the anchor text already exists in this article or would have to
 *     be written in.
 *   - An external source is a SUGGESTION. Its verification state is shown on
 *     every row, and in this milestone it is always "unverified", because
 *     Cynth has no way to fetch a URL.
 *   - Structured-data eligibility is decided by the data Cynth holds. An
 *     ineligible type lists exactly what is missing rather than being hidden.
 */

interface Props {
  internalLinks: InternalLinkOpportunity[];
  externalSources: ExternalSourceOpportunity[];
  imageRequirements: ImageSeoRequirement[];
  structuredData: StructuredDataOpportunity[];
  diagnostics: SeoDiagnostics | null;
  onLinkDecision: (id: number, status: 'approved' | 'rejected') => void;
  onSourceDecision: (id: number, status: 'approved' | 'rejected') => void;
  busyId: number | null;
}

function StatusPill({ status }: { status: string }) {
  return <span className={`seo-pill seo-pill--${status}`}>{status}</span>;
}

export function SeoOpportunities({
  internalLinks,
  externalSources,
  imageRequirements,
  structuredData,
  diagnostics,
  onLinkDecision,
  onSourceDecision,
  busyId,
}: Props) {
  return (
    <div className="seo-opportunities">
      {/* ------------------------------------------------ internal links */}
      <section>
        <h4>Internal links</h4>
        <p className="seo-form__hint">
          Only articles that exist in Cynth are ever suggested. Approving one records the decision — nothing is
          inserted into the article.
        </p>
        {internalLinks.length === 0 ? (
          <p className="seo-empty">No internal link opportunities were found.</p>
        ) : (
          <ul className="seo-cards">
            {internalLinks.map((link) => (
              <li key={link.id} className="seo-card">
                <div className="seo-card__head">
                  <Link to={`/articles/${link.targetArticleId}`}>{link.targetTitle}</Link>
                  <StatusPill status={link.status} />
                </div>
                {link.anchorSuggestion && (
                  <p className="seo-card__anchor">
                    Anchor: <code>{link.anchorSuggestion}</code>{' '}
                    <span className="seo-card__note">
                      {link.anchorFoundInSource
                        ? '(this phrase already appears in the article)'
                        : '(you would need to write this phrase in)'}
                    </span>
                  </p>
                )}
                {link.reason && <p className="seo-card__reason">{link.reason}</p>}
                {link.relevance !== null && (
                  <p className="seo-card__meta">Relevance {Math.round(link.relevance * 100)}%</p>
                )}
                {link.status === 'proposed' && (
                  <div className="seo-finding__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={busyId === link.id}
                      onClick={() => onLinkDecision(link.id, 'approved')}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={busyId === link.id}
                      onClick={() => onLinkDecision(link.id, 'rejected')}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------- external sources */}
      <section>
        <h4>External sources</h4>
        <p className="seo-form__hint">
          These are <strong>recommended</strong> sources, not verified ones. Cynth has no way to fetch a URL in this
          version, so nothing here has been checked and no URL is invented.
        </p>
        {externalSources.length === 0 ? (
          <p className="seo-empty">No external source opportunities were identified.</p>
        ) : (
          <ul className="seo-cards">
            {externalSources.map((source) => (
              <li key={source.id} className="seo-card">
                <div className="seo-card__head">
                  <strong>{source.sourceType ?? source.suggestedDomain ?? 'A supporting source'}</strong>
                  <span className="seo-pill seo-pill--unverified">{source.verificationStatus}</span>
                </div>
                {source.claimContext && <blockquote className="seo-finding__excerpt">{source.claimContext}</blockquote>}
                {source.rationale && <p className="seo-card__reason">{source.rationale}</p>}
                {source.suggestedDomain && <p className="seo-card__meta">Suggested domain: {source.suggestedDomain}</p>}
                {source.suggestedUrl && (
                  <p className="seo-card__meta">
                    Suggested URL: <code>{source.suggestedUrl}</code> — not checked by Cynth.
                  </p>
                )}
                {source.status === 'proposed' && (
                  <div className="seo-finding__actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={busyId === source.id}
                      onClick={() => onSourceDecision(source.id, 'approved')}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={busyId === source.id}
                      onClick={() => onSourceDecision(source.id, 'rejected')}
                    >
                      Reject
                    </button>
                  </div>
                )}
                {source.status === 'approved' && (
                  <p className="seo-card__note">
                    Approved — still unverified. Approving a suggestion is not the same as checking it.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------- image SEO */}
      <section>
        <h4>Image SEO</h4>
        <p className="seo-form__hint">
          Requirements only. Cynth creates no images and invents no image URLs in this version.
        </p>
        {imageRequirements.length === 0 ? (
          <p className="seo-empty">No image requirements.</p>
        ) : (
          <ul className="seo-cards">
            {imageRequirements.map((requirement) => (
              <li key={requirement.id} className="seo-card">
                <div className="seo-card__head">
                  <strong>{requirement.placement ?? 'Image'}</strong>
                  <StatusPill status={requirement.status} />
                </div>
                {requirement.existingSource && (
                  <p className="seo-card__meta">
                    Existing image: <code>{requirement.existingSource}</code>
                  </p>
                )}
                {requirement.purpose && <p className="seo-card__reason">{requirement.purpose}</p>}
                <dl className="seo-card__fields">
                  <div>
                    <dt>Alt text</dt>
                    <dd>{requirement.altText ?? <em>Not written</em>}</dd>
                  </div>
                  <div>
                    <dt>Filename</dt>
                    <dd>{requirement.filenameSuggestion ?? <em>Not suggested</em>}</dd>
                  </div>
                  <div>
                    <dt>Caption</dt>
                    <dd>{requirement.caption ?? <em>None</em>}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --------------------------------------------- structured data */}
      <section>
        <h4>Structured data</h4>
        <p className="seo-form__hint">
          Eligibility is decided by the data Cynth actually holds, not by whether a schema type sounds applicable.
        </p>
        <ul className="seo-cards">
          {structuredData.map((opportunity) => (
            <li key={opportunity.type} className="seo-card">
              <div className="seo-card__head">
                <strong>{opportunity.label}</strong>
                <span className={`seo-pill seo-pill--${opportunity.eligible ? 'eligible' : 'ineligible'}`}>
                  {opportunity.eligible ? 'Eligible' : 'Not eligible'}
                </span>
              </div>
              <p className="seo-card__reason">{opportunity.rationale}</p>
              {opportunity.unmetRequirements.length > 0 && (
                <ul className="seo-card__requirements">
                  {opportunity.unmetRequirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ----------------------------------------------- diagnostics */}
      {diagnostics && (
        <section>
          <h4>Measurements</h4>
          <p className="seo-form__hint">
            Numbers about the text, not judgements about it. Nothing here is a target — keyword frequency in
            particular is shown so you can read it, never so you can hit it.
          </p>
          <dl className="seo-diagnostics">
            <div>
              <dt>Words</dt>
              <dd>{diagnostics.wordCount}</dd>
            </div>
            <div>
              <dt>Reading time</dt>
              <dd>
                {diagnostics.estimatedReadingMinutes ?? '—'} min
                <span className="seo-card__note"> at {diagnostics.readingSpeedWpm} wpm</span>
              </dd>
            </div>
            <div>
              <dt>Sentences</dt>
              <dd>
                {diagnostics.sentenceCount}
                <span className="seo-card__note"> avg {diagnostics.averageSentenceWords ?? '—'} words</span>
              </dd>
            </div>
            <div>
              <dt>Paragraphs</dt>
              <dd>{diagnostics.paragraphCount}</dd>
            </div>
            <div>
              <dt>Headings</dt>
              <dd>{diagnostics.headingCount}</dd>
            </div>
            <div>
              <dt>Links</dt>
              <dd>
                {diagnostics.internalLinkCount} internal / {diagnostics.externalLinkCount} external
              </dd>
            </div>
            <div>
              <dt>Images</dt>
              <dd>
                {diagnostics.imageCount}
                {diagnostics.imagesMissingAlt > 0 && ` (${diagnostics.imagesMissingAlt} without alt text)`}
              </dd>
            </div>
          </dl>

          {diagnostics.keywordUsage.length > 0 && (
            <table className="seo-table">
              <caption>Term usage — diagnostic, never a target</caption>
              <thead>
                <tr>
                  <th>Term</th>
                  <th>Role</th>
                  <th>In body</th>
                  <th>In headings</th>
                  <th>Frequency</th>
                  <th>Placement</th>
                </tr>
              </thead>
              <tbody>
                {diagnostics.keywordUsage.map((usage) => (
                  <tr key={`${usage.role}-${usage.term}`}>
                    <td>{usage.term}</td>
                    <td>{usage.role}</td>
                    <td>{usage.occurrences}</td>
                    <td>{usage.headingOccurrences}</td>
                    <td>{usage.density === null ? '—' : `${(usage.density * 100).toFixed(2)}%`}</td>
                    <td className="seo-table__placement">
                      {[
                        usage.inTitle && 'title',
                        usage.inSeoTitle && 'SEO title',
                        usage.inMetaDescription && 'description',
                        usage.inSlug && 'slug',
                        usage.inIntroduction && 'intro',
                      ]
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
