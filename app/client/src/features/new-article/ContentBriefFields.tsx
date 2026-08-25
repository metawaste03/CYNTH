export interface ContentBriefValues {
  targetAudience: string;
  searchIntent: string;
  readerPainPoints: string;
  questionsToAnswer: string;
  importantTopics: string;
  notes: string;
}

interface ContentBriefFieldsProps {
  values: ContentBriefValues;
  onChange: (field: keyof ContentBriefValues, value: string) => void;
}

export function ContentBriefFields({ values, onChange }: ContentBriefFieldsProps) {
  return (
    <div className="content-brief">
      <label>
        Target Audience
        <textarea rows={2} value={values.targetAudience} onChange={(e) => onChange('targetAudience', e.target.value)} />
      </label>
      <label>
        Search Intent
        <textarea rows={2} value={values.searchIntent} onChange={(e) => onChange('searchIntent', e.target.value)} />
      </label>
      <label>
        Reader Pain Points
        <textarea rows={3} value={values.readerPainPoints} onChange={(e) => onChange('readerPainPoints', e.target.value)} />
      </label>
      <label>
        Questions To Answer
        <textarea rows={3} value={values.questionsToAnswer} onChange={(e) => onChange('questionsToAnswer', e.target.value)} />
      </label>
      <label>
        Important Topics To Cover
        <textarea rows={3} value={values.importantTopics} onChange={(e) => onChange('importantTopics', e.target.value)} />
      </label>
      <label>
        Notes
        <textarea rows={3} value={values.notes} onChange={(e) => onChange('notes', e.target.value)} />
      </label>
    </div>
  );
}
