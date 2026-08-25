import { useState } from 'react';

/** "Generate Title" / "Generate Long-tail Keywords" — no AI here yet, just the promised message. */
export function ComingSoonButton({ label }: { label: string }) {
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="coming-soon">
      <button type="button" className="button" onClick={() => setMessage('Available in a future milestone.')}>
        {label}
      </button>
      {message && (
        <span className="coming-soon__message" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
