#!/usr/bin/env bash
# Kiểm tra server có kết nối được tới SSO và các hệ thống QLVB của tỉnh không.
# Dùng -k vì *.laocai.gov.vn gửi thiếu chứng chỉ trung gian (app tự bù bằng certs/); ở đây chỉ kiểm tra mạng.
ok=1
for u in https://login.yenbai.gov.vn https://id.vnpthub.vn https://egov-gateway.laocai.gov.vn https://egov-storage1.laocai.gov.vn https://csdlvb.laocai.gov.vn https://csdlvb-backend.laocai.gov.vn; do
  out=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 15 "$u" 2>&1); code=$?
  if [ $code -eq 0 ] && [ "$out" != "000" ]; then printf "OK   %s  %s\n" "$out" "$u"
  else ok=0; printf "LỖI  %s  (curl mã %s: %s)\n" "$u" "$code" "$(curl -sk -o /dev/null --max-time 15 "$u" 2>&1 | head -1)"; fi
done
[ $ok = 1 ] && echo "=> Kết nối được tất cả hệ thống." || echo "=> Có hệ thống không kết nối được (mã 6 = không phân giải DNS, 7/28 = bị chặn/timeout)."
