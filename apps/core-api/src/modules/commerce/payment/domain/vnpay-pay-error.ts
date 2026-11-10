const VNPAY_PAY_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  '07': 'Tài khoản đã bị trừ tiền nhưng giao dịch bị nghi ngờ gian lận. Vui lòng liên hệ ngân hàng để được hỗ trợ.',
  '09': 'Thẻ hoặc tài khoản của bạn chưa đăng ký Internet Banking. Vui lòng đăng ký với ngân hàng hoặc chọn cách thanh toán khác.',
  '10': 'Thông tin thẻ hoặc tài khoản đã được xác thực sai quá 3 lần. Vui lòng kiểm tra lại hoặc chọn cách thanh toán khác.',
  '11': 'Đã hết thời gian chờ thanh toán. Vui lòng thử lại.',
  '12': 'Thẻ hoặc tài khoản của bạn đang bị khóa. Vui lòng liên hệ ngân hàng hoặc chọn cách thanh toán khác.',
  '13': 'Mã OTP không đúng. Vui lòng thử thanh toán lại và kiểm tra mã OTP.',
  '24': 'Bạn đã hủy giao dịch thanh toán.',
  '51': 'Tài khoản không đủ số dư. Vui lòng nạp thêm tiền hoặc chọn cách thanh toán khác.',
  '65': 'Giao dịch vượt hạn mức thanh toán trong ngày. Vui lòng liên hệ ngân hàng hoặc chọn cách thanh toán khác.',
  '75': 'Ngân hàng đang bảo trì. Vui lòng thử lại sau hoặc chọn cách thanh toán khác.',
  '79': 'Bạn đã nhập sai mật khẩu thanh toán quá số lần cho phép. Vui lòng liên hệ ngân hàng để được hỗ trợ.',
};

const VNPAY_GENERIC_PAY_ERROR = 'Thanh toán VNPay không thành công, vui lòng thử lại hoặc chọn cách thanh toán khác.';

export function describeVnpayPayError(code: string | undefined | null): string {
  return (code && Object.hasOwn(VNPAY_PAY_ERROR_MESSAGES, code) ? VNPAY_PAY_ERROR_MESSAGES[code] : undefined) ?? VNPAY_GENERIC_PAY_ERROR;
}
