/**
 * Port kết nối tới module commerce để kiểm tra tính hợp lệ của đơn đặt chỗ.
 * Tránh việc module content phụ thuộc cứng vào implementation của commerce.
 */
export interface CommerceServicePort {
  /**
   * Kiểm tra xem đơn đặt chỗ có tồn tại, thuộc về user này và đã hoàn tất (check-out) hay chưa.
   */
  verifyCompletedBooking(bookingId: string, userId: string): Promise<boolean>;
}

export const COMMERCE_SERVICE_PORT = Symbol('COMMERCE_SERVICE_PORT');
