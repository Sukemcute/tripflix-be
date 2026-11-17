// Public API duy nhất của module content. Module khác chỉ được import từ file này.
export { ContentModule } from './content.module.js';
export {
  ContentFacade,
  type VisiblePostSummary,
  type PostStatsSummary,
  type ListPostsFacadeQuery,
  type ListPostsFacadeResult,
} from './content.facade.js';
export { MediaFacade, type PlaybackInfo } from './media/media.facade.js';
export { FeedFacade } from './feed/feed.facade.js';
export type { FeedCard, FeedPage } from './feed/application/feed.use-cases.js';
