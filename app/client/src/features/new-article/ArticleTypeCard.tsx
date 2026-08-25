import { useState } from 'react';
import type { ArticleType } from '../../shared/types/articleType';

interface ArticleTypeCardProps {
  type: ArticleType;
  isSelected: boolean;
  onSelect: () => void;
}

/**
 * A single selectable article type. Built on a native radio input (inside a
 * <label>) so "select exactly one" and "clearly see which is selected" come
 * for free from browser/AT semantics, rather than being reimplemented by
 * hand. The help (?) button is a sibling of the label, not nested inside it
 * — an interactive element can't legally nest inside another one.
 */
export function ArticleTypeCard({ type, isSelected, onSelect }: ArticleTypeCardProps) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const helpId = `article-type-help-${type.id}`;

  return (
    <div className={`article-type-card${isSelected ? ' is-selected' : ''}`}>
      <label className="article-type-card__label">
        <input
          type="radio"
          name="articleType"
          className="article-type-card__radio"
          checked={isSelected}
          onChange={onSelect}
        />
        <span className="article-type-card__name">{type.name}</span>
        <span className="article-type-card__description">{type.description}</span>
        {isSelected && <span className="status-badge is-active article-type-card__badge">Selected</span>}
      </label>

      <button
        type="button"
        className="article-type-card__help"
        aria-label={`About ${type.name}`}
        aria-expanded={isHelpOpen}
        aria-controls={helpId}
        onClick={() => setIsHelpOpen((open) => !open)}
      >
        ?
      </button>

      {isHelpOpen && (
        <p id={helpId} className="article-type-card__help-panel" role="note">
          {type.description}
        </p>
      )}
    </div>
  );
}
