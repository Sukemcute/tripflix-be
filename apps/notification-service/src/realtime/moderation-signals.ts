import {
  ContentModerationChangedV1Schema,
  ContentModerationDecidedV1Schema,
  ContentReportCreatedV1Schema,
  ContentAppealDecidedV1Schema,
  ContentCommentModerationActionV1Schema,
  ContentPostHiddenV1Schema,
  ContentPostRestoredV1Schema,
  ContentPostModeratedV1Schema,
  ContentPostHeldV1Schema,
  ContentCommentHeldV1Schema,
  type EventEnvelope,
} from '@tripflix/contracts';

const schemas = {
  'content.moderation.changed': ContentModerationChangedV1Schema,
  'content.moderation.decided': ContentModerationDecidedV1Schema,
  'content.report.created': ContentReportCreatedV1Schema,
  'content.appeal.decided': ContentAppealDecidedV1Schema,
  'content.comment.moderation_action': ContentCommentModerationActionV1Schema,
  'content.post.hidden': ContentPostHiddenV1Schema,
  'content.post.restored': ContentPostRestoredV1Schema,
  'content.post.moderated': ContentPostModeratedV1Schema,
  'content.post.held': ContentPostHeldV1Schema,
  'content.comment.held': ContentCommentHeldV1Schema,
};

/** Coalesce invalidations across all cases; no content or identifiers reach the staff socket. */
export class ModerationSignals {
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly emit: () => void) {}

  handle(event: EventEnvelope): void {
    const schema = schemas[event.type as keyof typeof schemas];
    if (event.version !== 1 || !schema?.safeParse(event.payload).success || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      try {
        this.emit();
      } catch {
        // Tín hiệu lỗi không làm hỏng inbox; admin vẫn tải lại định kỳ.
      }
    }, 250);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
