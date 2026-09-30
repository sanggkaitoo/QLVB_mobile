# Tra cứu tiến độ văn bản trình egov1

Khảo sát trực tiếp ngày 30/09/2026 trên phiên egov được người dùng cho phép; đối chiếu màn hình danh sách, chi tiết, lịch sử luân chuyển và tiến trình xử lý. Tính năng chỉ đọc, không gửi trình/duyệt/ký/trả lại.

## API đã xác minh

Gateway: `https://egov-gateway.laocai.gov.vn`, xác thực Bearer bằng phiên egov1 hiện có. API work có cấu trúc khác iOffice.

| GET | Kết quả |
| --- | --- |
| `/work/api/works/v2?page=1&length=10&skip=0&term=&archiveSearch=false&WorkCreateType=1&currentType=sendDraft&type=sendDraft&isLoading=true&defer=true` | `{data: [...], total: number}` |
| Cùng API, `currentType=doing&type=doing` | Nhóm Đã xử lý của tài khoản |
| Cùng API, `currentType=waitingToPublished&type=waitingToPublished` | Nhóm Chờ phát hành |
| Cùng API, `currentType=refuse&type=refuse` | Trả lại; mẫu thực tế trùng nhiệm vụ trong Chờ xử lý |
| `/work/api/works/{id}?includeChildren=false&readContext=false` | Đối tượng nhiệm vụ chi tiết trực tiếp |

Giao diện gốc còn đọc `/work/api/works/{id}/follow`, `/work/api/works/by-assign/{id}`, `/work/api/works/minor/{id}`, `/work/api/workComment/getCommentByWorkId?workId=...`; tính năng này không cần gọi các API phụ vì dữ liệu chính đã chứa phản hồi và luân chuyển.

## Các trường và ý nghĩa

| Trường | Cách hiển thị |
| --- | --- |
| `id`, `content` | ID để loại trùng, trích yếu nhiệm vụ |
| `profileStatus` | Tiến độ trình thực tế; giá trị mới chưa biết hiển thị nguyên mã |
| `isProcessed` | Tài khoản đã xử lý; không chứng minh văn bản đã hoàn tất |
| `leaderApprove`, `leaderSign`, trường `...FullName` | Người duyệt/ký dự phòng khi thiếu tên trong luân chuyển |
| `userApis[].id/fullName/assignFollowType` | Ánh xạ ID sang tên, cùng người tham gia theo vai trò |
| `assignTransitions[].senderId/receiveId/insertDate/followType/content` | Lịch sử chuyển trình; `3=Approved`, `4=Sign`, `9=Refuse` theo enum frontend hiện hành |
| `feedbacks[].fullName/content/createAt/profileStatus` | Toàn bộ phản hồi và sự kiện trình; lọc các trạng thái trả lại để hiện riêng ý kiến lãnh đạo |
| `workingDate/createAt/deadLineDate` | Cập nhật tiến độ, ngày tạo, hạn xử lý |
| `attachmentApis[].fileName` | Danh sách tên tệp dự thảo; không mở sửa/tải từ module tiến độ |
| `info.missionContent` | Nội dung nhiệm vụ/chỉ đạo nếu có |

Các trạng thái lấy từ enum `ProfileStatus` và nhãn trong frontend egov: `Created`, `AwaitingApproval`, `AwaitingToSign`, `SendAuditor`, `AwaitLeaderApproval`, `Censored`, `LeaderApproved`, `RefuseCensorship`, `RefuseToSign`, `AuditorRefuse`, `LeaderRefuse`, `RefuseCensorship2`, `RefuseToSign2`, `RefuseToRelease`, cùng các trạng thái đóng/hủy. Không dùng `taskPercent` để suy ra phần trăm trình duyệt.

## Quy tắc triển khai

- Đọc hết các trang của cả ba nhóm với độ dài 10 như web gốc, loại trùng theo `id`; nhóm Đang trả lại là bộ lọc trạng thái hiện tại trong tập ba nhóm, không cộng thêm một tập riêng.
- Người nhận sau trả lại lấy từ luân chuyển `followType=9` gần nhất. `leaderApprove` có thể còn là lãnh đạo trước đó, không dùng nó làm người đang nhận văn bản trả lại.
- Giữ tất cả ý kiến trả lại, kể cả ý kiến chỉ có dấu chấm. Không thay thế chỉ đạo trước đó bằng một ý kiến rỗng; người dùng xem cả lịch sử.
- Chi tiết luôn gọi `readContext=false`; không đánh dấu đã xem. API mới được giới hạn các đường dẫn đọc danh sách/chi tiết, không có phương thức thay đổi nghiệp vụ.
- Dữ liệu nhiệm vụ chỉ giữ trong bộ nhớ phiên giao diện, không đưa vào localStorage, không cache API. Đăng xuất egov xóa dữ liệu và ngăn phản hồi cũ cập nhật lại UI.
- Lỗi một nhóm vẫn hiển thị phần tải được, đánh dấu danh sách chưa đầy đủ; hết phiên yêu cầu đăng nhập lại và xóa kết quả cũ.
- Thời gian không có offset từ API được hiểu là giờ Việt Nam, hiển thị theo Asia/Ho_Chi_Minh.
- Bộ lọc từ khóa áp dụng trên toàn bộ tập đã tải: trích yếu, người nhận, trạng thái, tác giả và nội dung phản hồi; hỗ trợ gõ không dấu.
- Phân trang giao diện riêng: 5, 10, 20, 50, 100 nhiệm vụ/trang. Nút Cập nhật tải lại danh sách theo quyền hiện tại của tài khoản.

## Kiểm chứng và giới hạn

Lượt khảo sát đầu: Chờ xử lý 2, Đã xử lý 2, Chờ phát hành 0, Trả lại 1 (trùng một nhiệm vụ Chờ xử lý). Khi kiểm chứng app trực tiếp lúc 15:20 ngày 30/09/2026: Chờ xử lý 2, Đã xử lý 1, Chờ phát hành 0, tổng 3 nhiệm vụ riêng biệt. Số lượng là ảnh chụp tại thời điểm kiểm tra, có thể thay đổi theo nghiệp vụ/quyền tài khoản.

Đã xác minh trực tiếp đọc ba nhóm và chi tiết văn bản trả lại qua giao diện app, không lỗi JavaScript/API, mọi yêu cầu tiến độ là GET và chi tiết có `readContext=false`. Nhóm Chờ phát hành chưa có bản ghi thực tế trong phiên khảo sát, nên nhánh hiển thị nhóm này được kiểm tra bằng dữ liệu mô phỏng theo cấu trúc API. Người đang nhận ở các giai đoạn chưa có mẫu sẽ hiện chưa xác định nếu dữ liệu không đủ, tránh tự suy diễn.

Kiểm tra tự động: đọc nhiều trang API, loại trùng giữa nhóm, người nhận trả lại, đầy đủ ý kiến trả lại, lọc/tìm không dấu, phân trang, phiên hết hạn, nguồn lỗi một phần, đóng chi tiết khi đang tải, trạng thái lạ/null, múi giờ, không tràn ngang ở 320/390/768/1024 px, giao diện tối. Các kiểm tra tra cứu văn bản, phân trang cũ và lỗi pool egov vẫn qua.

Mã: `public/js/egov-work.js` (API/model), `public/js/progress.js` (UI), `public/js/egov1.js` (dùng chung phiên và refresh). Không đưa Bearer token hay nội dung hồ sơ thật vào source/fixture của app.
