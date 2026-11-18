# Gắn response headers policy CORS có credentials vào behavior video (TF64). Dùng trong setup-video-cors.sh.
# Vào: kết quả get-distribution-config, $policyId. Ra: DistributionConfig mới.
.DistributionConfig
| .CacheBehaviors.Items |= map(
    # Gồm cả `dev/*.m3u8`, `dev/*.ts` của set-dev-video.sh: hls.js gửi cookie tới mọi video, kể cả video dev.
    if (.PathPattern | IN("*.m3u8", "*.ts", "dev/*.m3u8", "dev/*.ts")) then .ResponseHeadersPolicyId = $policyId else . end
  )
