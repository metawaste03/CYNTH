import type { ReactNode } from 'react';
import type { ContentBriefValues } from './ContentBriefFields';

interface EditorialReviewSummaryProps {
  articleTypeName: string | null;
  authorName: string | null;
  topic: string;
  title: string;
  primaryKeyword: string;
  secondaryKeywords: string;
  productName: string | null;
  productBrand: string | null;
  brief: ContentBriefValues;
  onEdit: (step: number) => void;
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <section className="review-section">
      <div className="review-section__header">
        <h3>{title}</h3>
        <button type="button" className="button" onClick={onEdit}>
          Edit
        </button>
      </div>
      <div className="review-section__body">{children}</div>
    </section>
  );
}

function Value({ children }: { children: ReactNode }) {
  const isEmpty = children === null || children === undefined || children === '';
  return isEmpty ? <span className="editorial-review__empty">Not set</span> : <>{children}</>;
}

export function EditorialReviewSummary({
  articleTypeName,
  authorName,
  topic,
  title,
  primaryKeyword,
  secondaryKeywords,
  productName,
  productBrand,
  brief,
  onEdit,
}: EditorialReviewSummaryProps) {
  return (
    <div className="editorial-review">
      <ReviewSection title="Article Type" onEdit={() => onEdit(1)}>
        <p>
          <Value>{articleTypeName}</Value>
        </p>
      </ReviewSection>

      <ReviewSection title="Author" onEdit={() => onEdit(2)}>
        <p>
          <Value>{authorName}</Value>
        </p>
      </ReviewSection>

      <ReviewSection title="Topic" onEdit={() => onEdit(3)}>
        <p>
          <Value>{topic}</Value>
        </p>
      </ReviewSection>

      <ReviewSection title="Title" onEdit={() => onEdit(4)}>
        <p>
          <Value>{title}</Value>
        </p>
      </ReviewSection>

      <ReviewSection title="Keywords" onEdit={() => onEdit(5)}>
        <dl>
          <div>
            <dt>Primary Keyword</dt>
            <dd>
              <Value>{primaryKeyword}</Value>
            </dd>
          </div>
          <div>
            <dt>Secondary Keywords</dt>
            <dd>
              <Value>{secondaryKeywords}</Value>
            </dd>
          </div>
        </dl>
      </ReviewSection>

      <ReviewSection title="Product" onEdit={() => onEdit(6)}>
        <p>{productName ? <>{productName}{productBrand ? ` · ${productBrand}` : ''}</> : <Value>{null}</Value>}</p>
      </ReviewSection>

      <ReviewSection title="Content Brief" onEdit={() => onEdit(7)}>
        <dl>
          <div>
            <dt>Target Audience</dt>
            <dd>
              <Value>{brief.targetAudience}</Value>
            </dd>
          </div>
          <div>
            <dt>Search Intent</dt>
            <dd>
              <Value>{brief.searchIntent}</Value>
            </dd>
          </div>
          <div>
            <dt>Reader Pain Points</dt>
            <dd>
              <Value>{brief.readerPainPoints}</Value>
            </dd>
          </div>
          <div>
            <dt>Questions To Answer</dt>
            <dd>
              <Value>{brief.questionsToAnswer}</Value>
            </dd>
          </div>
          <div>
            <dt>Important Topics To Cover</dt>
            <dd>
              <Value>{brief.importantTopics}</Value>
            </dd>
          </div>
          <div>
            <dt>Notes</dt>
            <dd>
              <Value>{brief.notes}</Value>
            </dd>
          </div>
        </dl>
      </ReviewSection>
    </div>
  );
}
