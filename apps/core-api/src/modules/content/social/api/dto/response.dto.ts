import { ApiProperty } from '@nestjs/swagger';
import { TripAttachmentDto } from './post.dto.js';

export class PostViewerContextDto {
  @ApiProperty({ type: String, enum: ['like', 'love', 'helpful'], nullable: true }) myReaction!:
    string | null;
  @ApiProperty() isBookmarked!: boolean;
}

// Document the existing wire format so generated clients do not treat JSON responses as void.
export class SocialPostDto {
  @ApiProperty() id!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty({ type: String, nullable: true, required: false, description: 'Tên hiển thị của tác giả' })
  authorName?: string | null;
  @ApiProperty({ enum: ['video', 'vlog'] }) postType!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: [String] }) hashtags!: string[];
  @ApiProperty({ enum: ['draft', 'published', 'hidden', 'removed', 'deleted'] }) status!: string;
  @ApiProperty({ enum: ['public', 'private'] }) visibility!: string;
  @ApiProperty() isVerified!: boolean;
  @ApiProperty({ type: [String] }) mediaIds!: string[];
  @ApiProperty({ type: String, nullable: true }) coverMediaId!: string | null;
  @ApiProperty({ type: TripAttachmentDto, nullable: true }) tripAttachment!: TripAttachmentDto | null;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) reactionCounts!: Record<
    string,
    number
  >;
  @ApiProperty() reactionTotal!: number;
  @ApiProperty() commentCount!: number;
  @ApiProperty() shareCount!: number;
  @ApiProperty() bookmarkCount!: number;
  @ApiProperty({ type: PostViewerContextDto, required: false, nullable: true })
  viewerContext?: PostViewerContextDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) publishedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deletedAt!: string | null;
}
export class SocialPostPageDto {
  @ApiProperty({ type: [SocialPostDto] }) items!: SocialPostDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() hasMore!: boolean;
}
export class SocialPostDetailDto {
  @ApiProperty({ type: SocialPostDto }) post!: SocialPostDto;
  @ApiProperty({ type: PostViewerContextDto }) viewerContext!: PostViewerContextDto;
  @ApiProperty() shareUrl!: string;
}
export class PublishedPostDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['published'] }) status!: string;
  @ApiProperty() isVerified!: boolean;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
  @ApiProperty() shareUrl!: string;
}
export class DeletedSocialItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() deleted!: boolean;
}
export class SharedPostDto {
  @ApiProperty() postId!: string;
  @ApiProperty() shareUrl!: string;
  @ApiProperty() shareCount!: number;
}
export class SocialCommentDto {
  @ApiProperty() id!: string;
  @ApiProperty() postId!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty({ type: String, nullable: true, required: false, description: 'Tên hiển thị của tác giả' })
  authorName?: string | null;
  @ApiProperty({ type: String, nullable: true }) parentCommentId!: string | null;
  @ApiProperty({ type: String, nullable: true, required: false, description: 'Tên hiển thị của người được trả lời' })
  replyToName?: string | null;
  @ApiProperty() body!: string;
  @ApiProperty() isEdited!: boolean;
  @ApiProperty({ example: 0, description: 'Số lượt thích bình luận' }) likeCount!: number;
  @ApiProperty({ example: false, description: 'Người xem hiện tại đã thích bình luận hay chưa' }) isLiked!: boolean;
  @ApiProperty({
    example: 0,
    required: false,
    description: 'Số trả lời còn hiển thị. Có trong danh sách bình luận; bình luận vừa tạo hoặc vừa sửa thì không có',
  })
  replyCount?: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: String, nullable: true }) deletedAt!: string | null;
}
export class UpdatedCommentReactionDto {
  @ApiProperty() commentId!: string;
  @ApiProperty() isLiked!: boolean;
  @ApiProperty() likeCount!: number;
}
export class SocialCommentPageDto {
  @ApiProperty({ type: [SocialCommentDto] }) items!: SocialCommentDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
  @ApiProperty() total!: number;
}
export class PostStatsDto {
  @ApiProperty() postId!: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) reactionCounts!: Record<
    string,
    number
  >;
  @ApiProperty() reactionTotal!: number;
  @ApiProperty() commentCount!: number;
  @ApiProperty() shareCount!: number;
  @ApiProperty() bookmarkCount!: number;
}
export class PostReactionDto {
  @ApiProperty() post_id!: string;
  @ApiProperty({ type: String, nullable: true }) type!: string | null;
}
export class UpdatedPostReactionDto {
  @ApiProperty() postId!: string;
  @ApiProperty({ type: String, nullable: true }) myReaction!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) reactionCounts!: Record<
    string,
    number
  >;
  @ApiProperty() reactionTotal!: number;
}
export class UpdatedBookmarkDto {
  @ApiProperty() postId!: string;
  @ApiProperty() isBookmarked!: boolean;
  @ApiProperty() bookmarkCount!: number;
}
export class SocialAuthorDto {
  @ApiProperty() id!: string;
  @ApiProperty() display_name!: string;
}
export class AdminSocialPostDto {
  @ApiProperty() id!: string;
  @ApiProperty({ type: SocialAuthorDto }) author!: SocialAuthorDto;
  @ApiProperty() title!: string;
  @ApiProperty() post_type!: string;
  @ApiProperty() status!: string;
  @ApiProperty() visibility!: string;
  @ApiProperty() report_count!: number;
  @ApiProperty() reaction_total!: number;
  @ApiProperty() comment_count!: number;
  @ApiProperty({ format: 'date-time' }) created_at!: string;
}
export class AdminSocialPostPageDto {
  @ApiProperty({ type: [AdminSocialPostDto] }) items!: AdminSocialPostDto[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
  @ApiProperty() total!: number;
}
export class SocialModerationHistoryDto {
  @ApiProperty() action_id!: string;
  @ApiProperty() action!: string;
  @ApiProperty() reason_code!: string;
  @ApiProperty({ type: String, nullable: true }) reason_detail!: string | null;
  @ApiProperty({ type: [String] }) report_ids!: string[];
  @ApiProperty() moderator_id!: string;
  @ApiProperty() created_at!: string;
}
export class AdminSocialPostDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty() post_type!: string;
  @ApiProperty() status!: string;
  @ApiProperty() visibility!: string;
  @ApiProperty() is_verified!: boolean;
  @ApiProperty({ type: SocialAuthorDto }) author!: SocialAuthorDto;
  @ApiProperty({ type: [String] }) media_ids!: string[];
  @ApiProperty({ type: String, nullable: true }) cover_media_id!: string | null;
  @ApiProperty({ type: [String] }) hashtags!: string[];
  @ApiProperty({ type: TripAttachmentDto, nullable: true }) trip_attachment!: TripAttachmentDto | null;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'number' } }) reaction_counts!: Record<
    string,
    number
  >;
  @ApiProperty() reaction_total!: number;
  @ApiProperty() comment_count!: number;
  @ApiProperty() share_count!: number;
  @ApiProperty() bookmark_count!: number;
  @ApiProperty() created_at!: string;
  @ApiProperty() updated_at!: string;
  @ApiProperty({ type: [SocialModerationHistoryDto] }) moderation_history!: SocialModerationHistoryDto[];
}
export class SocialModerationResultDto {
  @ApiProperty() actionId!: string;
  @ApiProperty() postId!: string;
  @ApiProperty() previousStatus!: string;
  @ApiProperty() postStatus!: string;
  @ApiProperty() moderatorId!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
