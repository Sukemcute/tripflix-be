import { InvalidReactionTypeException } from './errors.js';

export type ReactionType = 'like' | 'love' | 'helpful';

export const VALID_REACTIONS: readonly ReactionType[] = ['like', 'love', 'helpful'] as const;

export interface ReactionProps {
  id: string;
  postId: string;
  userId: string;
  type: ReactionType;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Thực thể cảm xúc (Reaction Domain Entity).
 */
export class Reaction {
  private props: ReactionProps;

  constructor(props: ReactionProps) {
    if (!VALID_REACTIONS.includes(props.type)) {
      throw new InvalidReactionTypeException(props.type);
    }
    this.props = { ...props };
  }

  get id(): string { return this.props.id; }
  get postId(): string { return this.props.postId; }
  get userId(): string { return this.props.userId; }
  get type(): ReactionType { return this.props.type; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  changeType(newType: ReactionType): void {
    if (!VALID_REACTIONS.includes(newType)) {
      throw new InvalidReactionTypeException(newType);
    }
    this.props.type = newType;
    this.props.updatedAt = new Date();
  }

  toRaw(): ReactionProps {
    return { ...this.props };
  }
}
