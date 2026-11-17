# Mở hoặc khoá lại video của máy dev (`dev/*`) trên CloudFront (TF82). Dùng trong set-dev-video.sh.
# Vào: kết quả get-distribution-config, $mode là "open" hoặc "close". Ra: DistributionConfig mới.
# open: behavior `dev/*` chép từ behavior mặc định (ảnh: công khai, Managed-SimpleCORS), đặt đầu danh sách vì CloudFront
# chọn behavior khớp đầu tiên, nên `dev/<tên>/....m3u8` không rơi vào behavior `*.m3u8` đang khoá. close: gỡ behavior đó.
.DistributionConfig as $config
| ($config.CacheBehaviors.Items // [] | map(select(.PathPattern != "dev/*"))) as $others
| $config
| .CacheBehaviors = (
    (if $mode == "open" then [$config.DefaultCacheBehavior + {PathPattern: "dev/*"}] else [] end)
    + $others
    | {Quantity: length, Items: .}
  )
