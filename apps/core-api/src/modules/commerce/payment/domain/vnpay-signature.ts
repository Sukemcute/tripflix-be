// Ký và kiểm chữ ký của VNPay (tài liệu "Thanh toán PAY", phiên bản 2.1.0). Hàm thuần: nhận sẵn hàm HMAC.
// Chuỗi ký: các tham số vnp_* (trừ vnp_SecureHash, vnp_SecureHashType) sắp theo tên, giá trị mã hoá kiểu form
// (dấu cách thành "+"), nối "key=value" bằng "&"; chữ ký là HMAC-SHA512 hex của chuỗi đó với vnp_HashSecret.

export type HmacSha512Hex = (secret: string, data: string) => string;

export const VNPAY_GATEWAY = 'vnpay';
/** Hạn của trang thanh toán VNPay (vnp_ExpireDate), tính từ lúc tạo URL. */
export const VNPAY_PAYMENT_WINDOW_MINUTES = 15;

const encodeFormValue = (value: string) => encodeURIComponent(value).replace(/%20/g, '+');

export function buildSignData(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k.startsWith('vnp_') && k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType' && params[k] !== '')
    .sort()
    .map((k) => `${k}=${encodeFormValue(params[k]!)}`)
    .join('&');
}

/** URL chuyển khách sang trang thanh toán của VNPay, đã ký. */
export function buildSignedUrl(baseUrl: string, params: Record<string, string>, secret: string, hmac: HmacSha512Hex): string {
  const data = buildSignData(params);
  return `${baseUrl}?${data}&vnp_SecureHash=${hmac(secret, data)}`;
}

/** Kiểm chữ ký của IPN / Return URL do VNPay gửi về. So sánh không phân biệt hoa thường như tài liệu. */
export function isValidSignature(params: Record<string, string>, secret: string, hmac: HmacSha512Hex): boolean {
  const received = params.vnp_SecureHash;
  if (!received) return false;
  return hmac(secret, buildSignData(params)).toLowerCase() === received.toLowerCase();
}

/** Ngày giờ theo múi giờ Việt Nam dạng yyyyMMddHHmmss, VNPay yêu cầu cho vnp_CreateDate / vnp_ExpireDate. */
export function formatVnpayDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

/** Kết quả VNPay: chỉ thành công khi cả mã phản hồi và trạng thái giao dịch là "00". */
export const isVnpaySuccess = (params: Record<string, string>) => params.vnp_ResponseCode === '00' && params.vnp_TransactionStatus === '00';

/** Mã đơn gửi VNPay (vnp_TxnRef): chỉ chữ và số, duy nhất cho mỗi lần trả. */
export const buildVnpayTxnRef = (orderId: string, attempt: number) => `${orderId.replace(/-/g, '')}${String(attempt).padStart(2, '0')}`;
