# Mở hoặc khoá lại video của máy dev (`dev/*`) trên CloudFront (TF82). Dùng trong set-dev-video.sh.
# Vào: kết quả get-distribution-config, $mode là "open" hoặc "close". Ra: DistributionConfig mới.
# open: thêm 3 behavior lên đầu danh sách, vì CloudFront chọn behavior khớp đầu tiên:
# - `dev/*.m3u8`, `dev/*.ts`: chép từ behavior `*.m3u8`, `*.ts` (giữ CORS có credentials `tripflix-video-cors`, vì
#   hls.js gửi cookie và trình duyệt không nhận `*`), chỉ bỏ khoá cookie.
# - `dev/*`: chép từ behavior mặc định (ảnh: công khai, Managed-SimpleCORS).
# close: gỡ mọi behavior bắt đầu bằng `dev/`.
.DistributionConfig as $config
| ($config.CacheBehaviors.Items // []) as $existing
| ($existing | map(select(.PathPattern | startswith("dev/") | not))) as $others
| def unlocked($pattern):
    (($others | map(select(.PathPattern == $pattern)) | first) // $config.DefaultCacheBehavior)
    + {PathPattern: "dev/\($pattern)", TrustedKeyGroups: {Enabled: false, Quantity: 0}};
  $config
  | .CacheBehaviors = (
      (if $mode == "open" then [unlocked("*.m3u8"), unlocked("*.ts"), $config.DefaultCacheBehavior + {PathPattern: "dev/*"}] else [] end)
      + $others
      | {Quantity: length, Items: .}
    )
