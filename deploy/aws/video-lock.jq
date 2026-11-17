# Bật hoặc tắt yêu cầu cookie ký trên behavior video (TF82). Dùng trong set-video-lock.sh.
# Vào: kết quả get-distribution-config, $mode là "on" hoặc "off", $keyGroupId. Ra: DistributionConfig mới.
.DistributionConfig
| .CacheBehaviors.Items |= map(
    if .PathPattern == "*.m3u8" or .PathPattern == "*.ts" then
      .TrustedKeyGroups = (
        if $mode == "on" then {Enabled: true, Quantity: 1, Items: [$keyGroupId]} else {Enabled: false, Quantity: 0} end
      )
    else . end
  )
