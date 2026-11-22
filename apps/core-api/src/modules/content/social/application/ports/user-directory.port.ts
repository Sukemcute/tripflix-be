/**
 * Port tra tên hiển thị người dùng từ module access (qua AccessFacade).
 * Module content không đọc bảng của access.
 */
export interface UserDirectoryPort {
  /** Map userId -> tên hiển thị; id không tìm thấy thì không có trong Map. */
  getDisplayNames(userIds: string[]): Promise<Map<string, string>>;
}

export const USER_DIRECTORY_PORT = Symbol('USER_DIRECTORY_PORT');
