import type { OrderStatus, PassengerType } from '../domain/order-rules.js';

export interface OrderRecord {
  id: string;
  userId: string;
  status: OrderStatus;
  total: number;
  adults: number;
  /** Vé bay: trẻ em 2–11 tuổi (chiếm ghế) và em bé dưới 2 tuổi (không chiếm ghế). */
  children: number;
  infants: number;
  sourcePostId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  holdExpiresAt: Date;
  confirmationCode: string | null;
  cancelReason: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

export interface OrderItemRecord {
  id: string;
  orderId: string;
  productType: 'room' | 'flight';
  productId: string;
  productName: string;
  /** Tên khách sạn của mục phòng; có khi đọc đơn, vé bay là null. */
  propertyName?: string | null;
  date: string;
  nights: number;
  qty: number;
  /** Phòng: một đêm một phòng. Vé bay: một vé người lớn. */
  unitPrice: number;
  /** Vé bay: một vé trẻ em, em bé; phòng là null. */
  childUnitPrice: number | null;
  infantUnitPrice: number | null;
  lineTotal: number;
  ratePlanCode: string;
  ratePlanName: string;
  isRefundable: boolean;
  freeCancelUntil: string | null;
  confirmationCode: string | null;
}

export type NewOrderItem = Omit<OrderItemRecord, 'id' | 'orderId' | 'confirmationCode'>;

export interface PaymentRecord {
  id: string;
  orderId: string;
  userId: string;
  gatewayKey: string;
  amount: number;
  status: 'initiated' | 'requires_action' | 'succeeded' | 'failed';
  gateway: string;
  gatewayRef: string | null;
  failureCode: string | null;
  cardLast4: string | null;
  challengeId: string | null;
  checkAttempts: number;
  createdAt: Date;
}

export interface RefundRecord {
  id: string;
  orderId: string;
  paymentId: string;
  gatewayKey: string;
  amount: number;
  status: 'initiated' | 'succeeded';
  checkAttempts: number;
  parentRef: string | null;
  /** Cổng của khoản trừ gốc: hoàn qua đúng cổng đó. */
  gateway: string;
}

/** Một ô tồn kho: một loại phòng / hạng ghế trong một ngày. */
export interface InventoryCell {
  productType: 'room' | 'flight';
  productId: string;
  date: string;
  qty: number;
}

/** Mọi hàm chạy trên transaction đang mở của commerce (TransactionHost); "lock" là SELECT ... FOR UPDATE. */
export interface OrderStore {
  /** Khoá theo tài khoản trong transaction: hai request giữ chỗ của cùng người chạy tuần tự. */
  lockUser(userId: string): Promise<void>;
  /** Giới hạn thời gian chờ khoá trong transaction đang mở; quá hạn thì lệnh đang chờ báo lỗi. */
  limitLockWait(milliseconds: number): Promise<void>;
  /** Lỗi này có phải do chờ khoá quá giới hạn của limitLockWait không. */
  isLockWaitTimeout(error: unknown): boolean;
  countOrdersCreatedSince(userId: string, since: Date): Promise<number>;
  findOrder(orderId: string): Promise<OrderRecord | null>;
  lockOrder(orderId: string): Promise<OrderRecord | null>;
  /** Đơn của người dùng theo trạng thái, khoá luôn để đổi trạng thái an toàn. */
  lockOrdersOfUser(userId: string, statuses: OrderStatus[]): Promise<OrderRecord[]>;
  /** Đơn quá hạn giữ, nhả được: pending, hoặc paying có khoản đang chờ OTP / đã quá hạn trang của cổng chuyển hướng. Đọc không khoá. */
  findExpiredHoldIds(input: { now: Date; redirectGateway: string; redirectStartedBefore: Date; limit: number }): Promise<string[]>;
  /** FOR UPDATE SKIP LOCKED: hàng đang bị giữ thì trả null, không chờ. */
  lockOrderSkipLocked(orderId: string): Promise<OrderRecord | null>;
  lockPaymentSkipLocked(paymentId: string): Promise<PaymentRecord | null>;
  /** Đơn của người dùng, mới nhất trước (created_at, id giảm dần), sau con trỏ nếu có. Đọc không khoá. */
  listOrdersOfUser(input: { userId: string; statuses?: OrderStatus[]; after?: { createdAt: Date; id: string }; limit: number }): Promise<OrderRecord[]>;
  /** Mục của nhiều đơn trong một câu truy vấn. */
  findItemsOfOrders(orderIds: string[]): Promise<OrderItemRecord[]>;
  insertOrder(order: { userId: string; total: number; adults: number; children: number; infants: number; sourcePostId: string | null; holdExpiresAt: Date }): Promise<string>;
  insertItems(orderId: string, items: NewOrderItem[]): Promise<void>;
  findItems(orderId: string): Promise<OrderItemRecord[]>;
  updateItemPrices(prices: { id: string; unitPrice: number; childUnitPrice: number | null; infantUnitPrice: number | null; lineTotal: number }[]): Promise<void>;
  setItemConfirmationCodes(codes: { id: string; code: string }[]): Promise<void>;
  updateOrder(orderId: string, patch: Partial<Pick<OrderRecord, 'status' | 'total' | 'contactName' | 'contactPhone' | 'contactEmail' | 'confirmationCode' | 'cancelReason' | 'paidAt'>> & { policyVersion?: string; policyAcceptedAt?: Date; cancelledAt?: Date }): Promise<void>;
  replaceGuests(orderId: string, guests: { fullName: string; birthdate: string | null; passengerType: PassengerType | null }[]): Promise<void>;
  findGuestBirthdates(orderId: string): Promise<(string | null)[]>;

  /**
   * Tồn kho, cập nhật có điều kiện từng ô (UPDATE ... WHERE), không đọc rồi ghi. Trả false khi ô không đủ chỗ;
   * use case ném lỗi để transaction rollback cả giỏ.
   */
  holdCell(cell: InventoryCell): Promise<boolean>;
  releaseCell(cell: InventoryCell): Promise<void>;
  /** held → sold khi đã trả tiền. */
  sellCell(cell: InventoryCell): Promise<boolean>;

  insertPayment(payment: { orderId: string; userId: string; gatewayKey: string; amount: number; gateway: string }): Promise<string>;
  lockPaymentByKey(gatewayKey: string): Promise<PaymentRecord | null>;
  /** Đọc không khoá theo khoá cổng (0 hoặc 1 dòng). */
  findPaymentsByKey(gatewayKey: string): Promise<PaymentRecord[]>;
  findPaymentByChallenge(orderId: string, challengeId: string): Promise<PaymentRecord | null>;
  findPaymentsOfOrder(orderId: string): Promise<PaymentRecord[]>;
  updatePayment(paymentId: string, patch: Partial<Pick<PaymentRecord, 'status' | 'gatewayRef' | 'failureCode' | 'cardLast4' | 'challengeId'>>): Promise<void>;
  countFailedCharges(orderId: string): Promise<number>;

  /** Chèn khoản hoàn; khoá đã có thì bỏ qua (chạy lại không hoàn hai lần). */
  insertRefund(refund: { orderId: string; paymentId: string; gatewayKey: string; amount: number; reason: string; needsReview: boolean }): Promise<void>;
  findInitiatedRefunds(orderId: string): Promise<RefundRecord[]>;
  markRefundSucceeded(refundId: string, gatewayRef: string): Promise<void>;

  /**
   * Đối soát: nhận một lô khoản đang initiated đã quá olderThanSeconds, đẩy lịch hỏi lần sau (giãn dần);
   * FOR UPDATE SKIP LOCKED để nhiều bản core-api không làm trùng.
   */
  claimDueCharges(input: { gateway: string; olderThanSeconds: number; limit: number; backoffSeconds: number[] }): Promise<PaymentRecord[]>;
  claimDueRefunds(input: { gateway: string; olderThanSeconds: number; limit: number; backoffSeconds: number[] }): Promise<RefundRecord[]>;
  markForReview(kind: 'charge' | 'refund', id: string): Promise<void>;
}

export const ORDER_STORE = Symbol('COMMERCE_ORDER_STORE');
/** Đồng hồ của server, thay được trong test. */
export type Clock = () => Date;
export const COMMERCE_CLOCK = Symbol('COMMERCE_CLOCK');
