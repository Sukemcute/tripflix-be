import { PostRepository } from '../../infra/post.repository.js';
import { assertPostMediaAllowed, prepareTripAttachment } from '../common/post-media.js';
import type { PostMediaPort } from '../ports/post-media.port.js';
import type {
  NewPostRecord,
  PostRecord,
  PostType,
  PostVisibility,
  TripAttachmentData,
} from '../../../db/schema/index.js';

export interface CreateDraftCommand {
  authorId: string;
  postType: PostType;
  title: string;
  body?: string;
  hashtags?: string[];
  visibility?: PostVisibility;
  mediaIds?: string[];
  coverMediaId?: string;
  tripAttachment?: TripAttachmentData | null;
}

export class CreateDraftUseCase {
  constructor(
    private readonly postRepository: PostRepository,
    private readonly postMedia?: PostMediaPort,
  ) {}

  async execute(command: CreateDraftCommand): Promise<PostRecord> {
    const title = command.title.trim();
    if (!title) {
      throw new Error('Tiêu đề bài đăng không được để trống');
    }
    await assertPostMediaAllowed(this.postMedia, {
      postType: command.postType,
      authorId: command.authorId,
      mediaIds: command.mediaIds ?? [],
    });
    const tripAttachment = await prepareTripAttachment(this.postMedia, command.authorId, command.tripAttachment);

    const newPost: NewPostRecord = {
      authorId: command.authorId,
      postType: command.postType,
      title,
      body: command.body?.trim() ?? '',
      hashtags: command.hashtags ?? [],
      status: 'draft',
      visibility: command.visibility ?? 'public',
      isVerified: false,
      mediaIds: command.mediaIds ?? [],
      coverMediaId: command.coverMediaId,
      tripAttachment: tripAttachment ?? null,
      reactionCounts: {},
      reactionTotal: 0,
      commentCount: 0,
      shareCount: 0,
      bookmarkCount: 0,
    };

    return this.postRepository.create(newPost);
  }
}
