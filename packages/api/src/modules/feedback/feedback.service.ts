import { desc } from 'drizzle-orm';
import { db, feedbackSubmissions, type FeedbackSubmission } from '@trace/db';

export interface FeedbackWithUser extends FeedbackSubmission {
  user: { id: string; name: string; email: string } | null;
}

export interface CreateFeedbackInput {
  rating: number;
  category: string;
  message: string;
  pageUrl?: string;
}

export async function submitFeedback(
  input: CreateFeedbackInput,
  userId?: string,
): Promise<FeedbackSubmission> {
  const [submission] = await db
    .insert(feedbackSubmissions)
    .values({
      userId: userId ?? null,
      rating: input.rating,
      category: input.category,
      message: input.message,
      pageUrl: input.pageUrl ?? null,
    })
    .returning();

  if (!submission) throw new Error('Failed to insert feedback');
  return submission;
}

export async function listFeedback(): Promise<FeedbackWithUser[]> {
  const rows = await db.query.feedbackSubmissions.findMany({
    orderBy: [desc(feedbackSubmissions.createdAt)],
    with: {
      user: {
        columns: { id: true, name: true, email: true },
      },
    },
  });

  return rows.map((r) => ({
    ...r,
    user: r.user ?? null,
  }));
}
