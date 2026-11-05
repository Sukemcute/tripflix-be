import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';

export interface RequestUser {
  id: string;
  role?: string;
}

/**
 * Decorator lấy thông tin user hiện tại từ Request.
 * Hỗ trợ request.user (từ AuthGuard) và header x-user-id (cho local/testing).
 */
export const CurrentUser = createParamDecorator(
  (data: { required?: boolean } | undefined, ctx: ExecutionContext): RequestUser | null => {
    const required = data?.required ?? true;
    const request = ctx.switchToHttp().getRequest();

    if (request.user?.id) {
      return { id: request.user.id, role: request.user.role };
    }

    const headerUserId = request.headers['x-user-id'];
    if (typeof headerUserId === 'string' && headerUserId.trim()) {
      return {
        id: headerUserId.trim(),
        role: (request.headers['x-user-role'] as string) ?? 'member',
      };
    }

    if (required) {
      throw new UnauthorizedException('Yêu cầu đăng nhập để thực hiện thao tác này');
    }

    return null;
  },
);
