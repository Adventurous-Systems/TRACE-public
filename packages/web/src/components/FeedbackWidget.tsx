'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { feedback } from '@/lib/api-client';

type Category = 'bug' | 'ux' | 'feature' | 'general';

const CATEGORY_LABELS: Record<Category, string> = {
  bug: 'Bug / broken',
  ux: 'UX / design',
  feature: 'Feature request',
  general: 'General',
};

export default function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [category, setCategory] = useState<Category>('general');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setRating(0);
    setHovered(0);
    setCategory('general');
    setMessage('');
    setSubmitted(false);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0 || !message.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await feedback.submit({
        rating,
        category,
        message: message.trim(),
        pageUrl: typeof window !== 'undefined' ? window.location.href : (pathname ?? undefined),
      });
      setSubmitted(true);
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  const displayRating = hovered || rating;

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => {
          setOpen(true);
          reset();
        }}
        className="fixed bottom-6 right-6 z-50 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg transition-colors"
        aria-label="Give feedback"
      >
        Feedback
      </button>

      {/* Modal backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setOpen(false);
              reset();
            }
          }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            {submitted ? (
              <div className="text-center py-4 space-y-2">
                <div className="text-3xl">🎉</div>
                <p className="font-semibold text-gray-800">Thanks for your feedback!</p>
                <p className="text-sm text-gray-500">It helps us improve TRACE.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Share feedback</h2>
                  <button
                    onClick={() => {
                      setOpen(false);
                      reset();
                    }}
                    className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Star rating */}
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Overall rating</label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          onMouseEnter={() => setHovered(star)}
                          onMouseLeave={() => setHovered(0)}
                          className={`text-2xl transition-colors ${
                            star <= displayRating ? 'text-yellow-400' : 'text-gray-200'
                          }`}
                          aria-label={`${star} star${star > 1 ? 's' : ''}`}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Category */}
                  <div className="space-y-1">
                    <label className="text-sm font-medium text-gray-700">Category</label>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCategory(c)}
                          className={`text-sm px-3 py-1 rounded-full border transition-colors ${
                            category === c
                              ? 'bg-brand-600 text-white border-brand-600'
                              : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                          }`}
                        >
                          {CATEGORY_LABELS[c]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Message */}
                  <div className="space-y-1">
                    <label htmlFor="feedback-msg" className="text-sm font-medium text-gray-700">
                      Tell us more
                    </label>
                    <textarea
                      id="feedback-msg"
                      rows={3}
                      maxLength={2000}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="What's working well or what could be better?"
                      className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                      required
                    />
                  </div>

                  {error && <p className="text-sm text-red-500">{error}</p>}

                  <Button
                    type="submit"
                    disabled={submitting || rating === 0 || !message.trim()}
                    className="w-full bg-brand-600 hover:bg-brand-700 text-white"
                  >
                    {submitting ? 'Sending…' : 'Send feedback'}
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
