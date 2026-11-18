# Gắn tên miền riêng và tách behavior cho video HLS (TF82). Dùng trong setup-media-domain.sh.
# Vào: kết quả get-distribution-config. Ra: DistributionConfig mới.
# Behavior video đã có thì giữ nguyên (kể cả trạng thái khoá), chưa có thì chép từ behavior mặc định.
.DistributionConfig as $config
| $config.DefaultCacheBehavior as $default
| ($config.CacheBehaviors.Items // []) as $existing
| ["*.m3u8", "*.ts"] as $videoPatterns
| def videoBehavior($pattern):
    ($existing | map(select(.PathPattern == $pattern)) | first) // ($default + {PathPattern: $pattern});
  $config
  | .Aliases = ((($config.Aliases.Items // []) + [$domain] | unique) | {Quantity: length, Items: .})
  | .ViewerCertificate = {
      ACMCertificateArn: $cert,
      SSLSupportMethod: "sni-only",
      MinimumProtocolVersion: "TLSv1.2_2021",
      CloudFrontDefaultCertificate: false
    }
  # Behavior `dev/...` (set-dev-video.sh) phải đứng trước behavior video, nếu không video dev lại bị khoá.
  | ($existing | map(select(.PathPattern | startswith("dev/")))) as $dev
  | .CacheBehaviors = (
      $dev
      + ($videoPatterns | map(videoBehavior(.)))
      + ($existing | map(select((.PathPattern | startswith("dev/")) or (.PathPattern as $p | $videoPatterns | index($p)) | not)))
      | {Quantity: length, Items: .}
    )
