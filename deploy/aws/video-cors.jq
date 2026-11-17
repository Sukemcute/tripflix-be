# Gắn response headers policy CORS có credentials vào behavior video (TF64). Dùng trong setup-video-cors.sh.
# Vào: kết quả get-distribution-config, $policyId. Ra: DistributionConfig mới.
.DistributionConfig
| .CacheBehaviors.Items |= map(
    if .PathPattern == "*.m3u8" or .PathPattern == "*.ts" then .ResponseHeadersPolicyId = $policyId else . end
  )
