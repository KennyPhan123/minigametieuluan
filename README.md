# Mê cung Hasaki — 10 vòng thi đấu

Game web tiếng Việt, giao diện đen trắng, điện thoại và laptop. Node.js + Canvas + WebSocket, không cần build.

```sh
npm ci
npm start
# http://localhost:3000
npm test
```

Server lắng nghe `0.0.0.0`, cổng mặc định 3000 (đổi bằng `PORT`). Khi triển khai online, dùng HTTPS và reverse proxy hỗ trợ WebSocket. Một tiến trình server là một phòng chung; không có mã phòng riêng.

## Cách tổ chức

1. Người vào đầu tiên là chủ phòng, không tham gia thi đấu. Những người sau nhập tên và vào phòng chờ.
2. Chủ phòng chọn số lượng tối thiểu (không tính chủ phòng), rồi bấm bắt đầu.
3. Mỗi vòng 60 giây, mê cung mới 31 × 23 ô, rương và một điểm xuất phát chung được chọn ngẫu nhiên lại mỗi vòng. Tất cả người chơi có cùng vị trí xuất phát. Hai vị trí cách nhau ít nhất 12 ô theo đường thẳng, và 30–70 ô theo đường đi ngắn nhất.
4. Di chuyển tự do: chạm và kéo joystick trên điện thoại, hoặc giữ WASD/phím mũi tên trên máy tính; thả tay/phím là dừng ngay. Có thể đổi hướng và đi chéo, có va chạm trượt dọc tường. Camera người chơi zoom gần, chỉ thấy rõ trong bán kính 2,5 ô và bị che hoàn toàn từ 4,5 ô; rương không hiện xuyên tường. Mỗi người chỉ thấy nhân vật của mình, không thấy nhân vật người khác dù đứng cùng chỗ; chủ phòng thấy toàn bộ bản đồ, trạng thái đúng/sai/đóng băng và bảng dẫn đầu.
Mỗi người có mũi tên hướng rương, xoay theo vị trí hiện tại. Đây là hướng thẳng tới rương, không phải chỉ dẫn đường đi hoặc hướng rẽ; chủ phòng vẫn xem toàn bộ bản đồ.

5. Chạm rương để trả lời. Người tới đầu tiên được điểm tìm rương và loại riêng hai trong ba đáp án sai (còn hai lựa chọn). Các người khác vẫn có đủ bốn lựa chọn.
6. Trả lời sai: hiệu ứng rung, trừ điểm, khóa di chuyển/chọn đáp án trong 7 giây. Lựa chọn sai bị gạch riêng cho người đó. Trả lời đúng: thông báo và đứng chờ.
7. Vòng kết thúc khi đủ **5 người đúng** hoặc hết 60 giây. Nếu phòng ít hơn 5 người, vẫn chờ hết thời gian.
8. Có người đúng: hiện lại câu hỏi, đáp án đúng và bảng điểm cuối vòng. Chủ phòng bấm qua màn.
9. Không có ai đúng (kể cả đã tới rương nhưng chưa giải được): chủ phòng thấy câu hỏi lớn, bốn lựa chọn chưa chọn. Chủ phòng chọn thay câu trả lời của lớp, hệ thống công bố đáp án; sau đó mới cho qua màn. Phần này không cộng/trừ điểm thi đấu.
10. Sau tổng kết vòng 10, chủ phòng bấm để xem bảng xếp hạng chung. Có thể quay về phòng chờ để chơi ván mới.

## Điểm số

- Đầu tiên tới rương: `100 + làm tròn(số giây còn lại)`, tối đa 160 điểm.
- Mỗi câu đúng: `100 + max(0, 50 − ceil(2 × thời gian từ khi chạm rương))`, tối đa 150 điểm. Thời gian đóng băng cũng được tính, không đặt lại bộ đếm khi thử lại.
- Mỗi lần sai: −30 điểm, điểm có thể âm.
- Đúng cả 10 vòng: thưởng 200 điểm ở bảng chung.
- Đồng điểm: ưu tiên số câu đúng, rồi tên.

## Mê cung và thời gian

Mê cung dạng cây (perfect maze), sinh bằng growing-tree: ưu tiên kéo dài hành lang rồi rẽ nhánh. **Không mở đường nối vòng**: giữa spawn và rương chỉ có một đường đúng. Mọi nhánh sai nằm ngoài đường đúng đều là nhánh cụt, phải quay lại chỗ rẽ mới tiếp tục được.

Bộ chọn spawn/rương còn yêu cầu trên đường đúng có **ít nhất 3 nhánh sai đi sâu từ 6 ô**, trong đó ít nhất một nhánh sâu từ 8 ô. Độ dài đường đúng vẫn giới hạn 30–70 ô để giữ vòng chơi 60 giây. Qua 200 seed kiểm thử: trung bình 31,77 ngõ cụt; đường đúng dài nhất được chọn là 70 ô, tương đương 12,7 giây di chuyển thuần ở tốc độ 5,5 ô/giây. Thời gian tìm đường và quay lại từ nhánh sai chưa nằm trong phép đo này; cần chơi thử để cân chỉnh độ khó.

Joystick, tốc độ, kích thước map, camera, điểm số và mũi tên hướng rương không thay đổi. Mũi tên chỉ phương hướng chứ không biết nhánh nào đúng.

## Kiểm thử

- `test/maze.js`: 200 seed, liên thông, viền kín, ngõ cụt, đồ thị không có chu trình, các nhánh sai đủ sâu và vị trí spawn/rương ngẫu nhiên có khoảng cách phù hợp.
- `test/client.js`: DOM/Canvas mô phỏng, phòng chờ, di chuyển tự do, dừng khi thả phím/tay, va chạm tường, joystick, ẩn đối thủ với người chơi nhưng hiện với chủ phòng, mũi tên đúng bốn hướng, gợi ý cá nhân, đóng băng, review, chuyển chủ phòng, câu hỏi lớp và bảng cuối.
- `test/smoke.js`: server thật với nhiều WebSocket; quyền chủ phòng, chặn nhảy thẳng tới rương, người tới đầu, freeze, đúng 5 người kết thúc sớm, thay mê cung, 10 vòng hết giờ, bắt buộc chọn câu hỏi lớp rồi mới qua màn.

`ROUND_MS` và `FREEZE_MS` có thể rút ngắn để chạy test; mặc định thực tế 60000 và 7000.

## Lưu ý triển khai

- Người vào giữa vòng chờ vòng sau, không được nhảy vào thi đấu giữa chừng.
- Chủ phòng rời đi: quyền điều hành chuyển cho người còn lại vào sớm nhất.
- Kết nối lại hiện tạo lượt tham gia mới, **không khôi phục điểm cũ**. Không tải lại trang khi đang thi đấu. Điểm và phòng chỉ nằm trong bộ nhớ, khởi động lại server sẽ xóa ván.
- Server quyết định câu trả lời, thời gian, điểm và tiến trình vòng. Kiểm tra tốc độ/tường cơ bản cho vị trí client; không phải hệ thống chống gian lận hoàn chỉnh.
- Đáp án đầy đủ nằm trong mã nguồn dự án; HTTP `/questions.js` chỉ trả nội dung câu hỏi và lựa chọn, không trả đáp án trước tổng kết.
