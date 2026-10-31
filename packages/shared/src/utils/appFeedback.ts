import { callRpc } from './tripEnd';
import type { TripEndResult } from './tripEnd';
import type { RpcCapableClient } from './restrictionUtils';

/** Feedback written in a portal is stored by the database (migration 20261103000001: app_feedback, submit_app_feedback) */
export type FeedbackApp = 'lgu-portal' | 'toda-portal';

export const FEEDBACK_COMMENT_MAX = 1000;

/** The sentence to show when the form cannot be sent yet, or null when it can (the database checks the same again) */
export function feedbackProblem(rating: number | null, comment: string): string | null {
  if (!rating && comment.trim().length === 0) return 'Choose a star rating or write a comment first.';
  if (comment.length > FEEDBACK_COMMENT_MAX) return `The comment is too long (at most ${FEEDBACK_COMMENT_MAX} characters).`;
  return null;
}

/**
 * Sends the feedback. The `token` names this one attempt: the database saves a token once, so a double click or a retry after a slow answer is one feedback. Who sent it
 * (name and role) is written by the database from the signed-in account, not by the browser.
 */
export const submitAppFeedback = (client: RpcCapableClient, f: { app: FeedbackApp; rating: number | null; comment: string; token: string }): Promise<TripEndResult> =>
  callRpc(client, 'submit_app_feedback', { p_app: f.app, p_rating: f.rating, p_comment: f.comment.trim() || null, p_client_token: f.token });
