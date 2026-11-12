import {
  InvalidPostStatusTransitionException,
  PostPublishValidationException,
  UnauthorizedPostActionException,
} from './errors.js';

export type PostType = 'video' | 'vlog';
export type PostStatus = 'draft' | 'published' | 'hidden' | 'removed' | 'deleted';
export type PostVisibility = 'public' | 'private';

export interface TripItineraryItem {
  day: number;
  title: string;
  location?: string;
  notes?: string;
  transport?: {
    mode: 'flight' | 'bus' | 'train' | 'car' | 'other';
    fromAirport?: string;
    toAirport?: string;
  };
}

export interface TripAttachment {
  bookingId?: string;
  hotelId?: string;
  hotelName?: string;
  destinationName?: string;
  daysCount?: number;
  estimatedCostPerPerson?: number;
  priceDisclaimer?: string;
  items?: TripItineraryItem[];
}

export interface PostProps {
  id: string;
  authorId: string;
  postType: PostType;
  title: string;
  body: string;
  hashtags: string[];
  status: PostStatus;
  visibility: PostVisibility;
  isVerified: boolean;
  mediaIds: string[];
  coverMediaId?: string;
  tripAttachment?: TripAttachment | null;
  reactionCounts?: Record<string, number>;
  reactionTotal?: number;
  commentCount?: number;
  shareCount?: number;
  bookmarkCount?: number;
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

/**
 * Thực thể bài đăng (Domain Model).
 * Chứa toàn bộ quy tắc nghiệp vụ cốt lõi, không phụ thuộc framework.
 */
export class Post {
  private props: PostProps;

  constructor(props: PostProps) {
    this.props = {
      ...props,
      reactionCounts: props.reactionCounts ?? {},
      reactionTotal: props.reactionTotal ?? 0,
      commentCount: props.commentCount ?? 0,
      shareCount: props.shareCount ?? 0,
      bookmarkCount: props.bookmarkCount ?? 0,
    };
  }

  get id(): string { return this.props.id; }
  get authorId(): string { return this.props.authorId; }
  get postType(): PostType { return this.props.postType; }
  get title(): string { return this.props.title; }
  get body(): string { return this.props.body; }
  get hashtags(): string[] { return [...this.props.hashtags]; }
  get status(): PostStatus { return this.props.status; }
  get visibility(): PostVisibility { return this.props.visibility; }
  get isVerified(): boolean { return this.props.isVerified; }
  get mediaIds(): string[] { return [...this.props.mediaIds]; }
  get coverMediaId(): string | undefined { return this.props.coverMediaId; }
  get tripAttachment(): TripAttachment | null | undefined { return this.props.tripAttachment; }
  get reactionCounts(): Record<string, number> { return { ...this.props.reactionCounts }; }
  get reactionTotal(): number { return this.props.reactionTotal ?? 0; }
  get commentCount(): number { return this.props.commentCount ?? 0; }
  get shareCount(): number { return this.props.shareCount ?? 0; }
  get bookmarkCount(): number { return this.props.bookmarkCount ?? 0; }
  get publishedAt(): Date | null | undefined { return this.props.publishedAt; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }
  get deletedAt(): Date | null | undefined { return this.props.deletedAt; }

  /** Kiểm tra quyền sở hữu */
  isOwnedBy(userId: string): boolean {
    return this.props.authorId === userId;
  }

  /** Cho phép xem hay không tùy theo trạng thái, quyền riêng tư và người xem */
  canBeViewedBy(viewerId?: string, isStaff = false): boolean {
    if (isStaff) return true;
    if (this.props.status === 'deleted' || this.props.status === 'hidden' || this.props.status === 'removed') {
      return false;
    }
    if (this.props.status === 'draft') {
      return viewerId === this.props.authorId;
    }
    if (this.props.visibility === 'private') {
      return viewerId === this.props.authorId;
    }
    return true;
  }

  /** Cập nhật nội dung bài đăng */
  update(
    userId: string,
    data: {
      title?: string;
      body?: string;
      hashtags?: string[];
      visibility?: PostVisibility;
      mediaIds?: string[];
      coverMediaId?: string;
      tripAttachment?: TripAttachment | null;
    },
  ): void {
    if (!this.isOwnedBy(userId)) {
      throw new UnauthorizedPostActionException('chỉnh sửa', this.id);
    }
    if (this.props.status === 'deleted' || this.props.status === 'removed') {
      throw new UnauthorizedPostActionException('chỉnh sửa bài đã bị xóa hoặc gỡ', this.id);
    }

    if (data.title !== undefined) this.props.title = data.title.trim();
    if (data.body !== undefined) this.props.body = data.body;
    if (data.hashtags !== undefined) this.props.hashtags = data.hashtags;
    if (data.visibility !== undefined) this.props.visibility = data.visibility;
    if (data.mediaIds !== undefined) this.props.mediaIds = data.mediaIds;
    if (data.coverMediaId !== undefined) this.props.coverMediaId = data.coverMediaId;
    if (data.tripAttachment !== undefined) {
      this.props.tripAttachment = data.tripAttachment;
      // Khi tác giả sửa đổi lộ trình, dấu xác thực booking cũ bị hủy bỏ để đảm bảo tính xác thực
      this.props.isVerified = false;
    }

    this.props.updatedAt = new Date();
  }

  /** Xuất bản bản nháp thành bài đăng công khai (Publish) */
  publish(userId: string, options: { isVerified: boolean }): void {
    if (!this.isOwnedBy(userId)) {
      throw new UnauthorizedPostActionException('xuất bản', this.id);
    }
    if (this.props.status !== 'draft') {
      throw new InvalidPostStatusTransitionException(this.props.status, 'published');
    }
    if (this.props.mediaIds.length === 0 && !this.props.body.trim()) {
      throw new PostPublishValidationException('Bài đăng phải có ít nhất 1 ảnh/video hoặc nội dung chữ');
    }

    this.props.status = 'published';
    this.props.isVerified = options.isVerified;
    this.props.publishedAt = new Date();
    this.props.updatedAt = new Date();
  }

  /** Xóa mềm bài viết */
  softDelete(userId: string, isSuperAdmin = false): void {
    if (!this.isOwnedBy(userId) && !isSuperAdmin) {
      throw new UnauthorizedPostActionException('xóa', this.id);
    }
    this.props.status = 'deleted';
    this.props.deletedAt = new Date();
    this.props.updatedAt = new Date();
  }

  /** Thực thi thao tác kiểm duyệt của Admin/Moderator */
  moderate(action: 'hide' | 'remove' | 'restore', targetStatus?: PostStatus): void {
    if (action === 'hide') {
      this.props.status = 'hidden';
    } else if (action === 'remove') {
      this.props.status = 'removed';
    } else if (action === 'restore') {
      // Phục hồi về trạng thái hợp lệ: nếu đã từng xuất bản thì về published, nếu chưa thì về draft
      this.props.status = targetStatus ?? (this.props.publishedAt ? 'published' : 'draft');
    }
    this.props.updatedAt = new Date();
  }

  /** Trả về dữ liệu lộ trình đã được ẩn danh (Masked) tuân thủ PRD F5 */
  getMaskedTripAttachment(): TripAttachment | null {
    if (!this.props.tripAttachment) return null;
    return {
      hotelId: this.props.tripAttachment.hotelId,
      hotelName: this.props.tripAttachment.hotelName,
      destinationName: this.props.tripAttachment.destinationName,
      daysCount: this.props.tripAttachment.daysCount,
      estimatedCostPerPerson: this.props.tripAttachment.estimatedCostPerPerson,
      priceDisclaimer: 'Giá chỉ mang tính chất tham khảo',
      items: this.props.tripAttachment.items?.map((item) => ({
        day: item.day,
        title: item.title,
        location: item.location,
        notes: item.notes,
        ...(item.transport && {
          transport: {
            mode: item.transport.mode,
            fromAirport: item.transport.fromAirport,
            toAirport: item.transport.toAirport,
          },
        }),
      })),
    };
  }

  toRaw(): PostProps {
    return { ...this.props };
  }
}
