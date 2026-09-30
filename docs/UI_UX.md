# Giao diện điện thoại và tablet

Giao diện web tham khảo Apple Human Interface Guidelines: màu trung tính, phân cấp chữ rõ, điều hướng dạng nổi và vật liệu kính ở lớp điều hướng. Thẻ văn bản dùng nền gần đục để đọc nội dung dài; không mô phỏng hiệu ứng khúc xạ Liquid Glass native.

## Điều hướng

Thứ tự: **Tra cứu → Đã chọn → Tài khoản → Nhiệm vụ**.

- Điện thoại/tablet: cuộn xuống ít nhất 36 px để ẩn thanh; cuộn lên ít nhất 14 px để hiện lại. Bỏ qua dao động nhỏ của ngón tay.
- Luôn hiện ở đầu trang, cuối trang và trang ngắn; đổi màn hình hoặc xoay thiết bị sẽ đặt lại trạng thái. Áp dụng khi chiều rộng dưới 1200 px hoặc thiết bị có con trỏ cảm ứng, kể cả tablet màn hình rộng.
- Ẩn khi đang nhập vào ô văn bản/ngày/số để dành chỗ cho bàn phím; hiện lại khi kết thúc nhập. Khi mở chi tiết, ngừng theo dõi cuộn trang nền; đóng chi tiết khôi phục điều hướng.
- Thanh chỉ ẩn về mặt hình ảnh, vẫn truy cập được bằng bàn phím và trình đọc màn hình. Tab tới thanh sẽ hiện lại và giữ hiện khi thao tác bằng bàn phím. Liên kết đầu trang “Đi đến điều hướng” hỗ trợ bỏ qua nội dung dài.
- Giữ khoảng trống cuối trang khi thanh ẩn để không làm nhảy bố cục. Khoảng trống tăng theo cỡ chữ. Xử lý cuộn dùng listener thụ động và requestAnimationFrame.

## Thiết kế

- Thanh điều hướng nổi với nền mờ, viền nhẹ và trạng thái tab rõ ràng; bảng tìm kiếm/thẻ văn bản có độ tương phản cao hơn.
- Chữ theo font hệ thống; một cột trên điện thoại, hai cột trên tablet. Nút điều hướng có vùng chạm tối thiểu 44 × 44 CSS px.
- Chế độ sáng/tối theo hệ thống; giảm chuyển động theo prefers-reduced-motion. prefers-reduced-transparency hoặc prefers-contrast: more chuyển các bề mặt sang nền đục.
- Khoảng cách cạnh màn hình sử dụng safe-area-inset cho vùng tai thỏ và thanh Home khi trình duyệt cung cấp.
- Không thay đổi API, quyền tài khoản, luồng đăng nhập hoặc nghiệp vụ. PWA shell v10 bao gồm navigation.js.

## Nguồn thiết kế

- [Apple — Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass): lớp điều hướng, sự rõ ràng của nội dung và thanh thu gọn khi cuộn.
- [Apple HIG — Materials](https://developer.apple.com/design/human-interface-guidelines/materials): chọn vật liệu cho điều hướng và nội dung.
- [Apple HIG — Layout](https://developer.apple.com/design/human-interface-guidelines/layout): bố cục thích ứng và vùng an toàn.
- [Apple HIG — Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility): độ tương phản và khả năng đọc.

## Kiểm chứng

Playwright/Chromium với tài nguyên tĩnh được phục vụ qua interception và dữ liệu API mô phỏng; không mở server phát triển và không gọi SSO/API thật.

- 320, 390, 768, 1024, 1366 và 1440 px; sáng/tối, dọc/ngang: không tràn ngang; vùng chạm điều hướng tối thiểu 44 px.
- Cuộn xuống/lên, dao động nhỏ, cạnh trang, thao tác chuột/cảm ứng và bàn phím, nhập liệu, mở/đóng chi tiết, đổi tab và resize: đạt.
- Phóng chữ 200% tại 390 và 768 px: tra cứu và tài khoản không tràn ngang.
- Các cặp màu chữ chính/chữ phụ trên nền thẻ và chữ thương hiệu trên nền tab đạt tối thiểu 4.5:1 trong cả hai theme. Đây là kiểm tra token màu, không phải chứng nhận toàn bộ giao diện.
- Giảm chuyển động không có animation; chế độ tương phản cao không có backdrop blur: đạt.
- Hồi quy tra cứu hai nguồn, mọi mức phân trang 5/10/20/50/100, chọn văn bản, chi tiết, ZIP, đăng nhập/đăng xuất mô phỏng, Nhiệm vụ và Văn bản chờ xử lý: đạt.
- Mọi tệp trong shell service worker v10 đều tồn tại. Chưa chạy lại kiểm thử offline service worker qua server và chưa kiểm chứng Safari trên thiết bị Apple thật.

Báo cáo và ảnh nằm trong `../tools/ui-qa/`: navigation-report.json, accessibility-shell-report.json, ui-static-report.json, pagination-report.json, progress-report.json, pending-report.json. Thư mục tools nằm ngoài repo app.