# Báo cáo: ẩn rương trên màn hình chủ phòng + kiểm tra khi có ~50 người chơi

Ngày 14/10/2026. Phạm vi: `server.js`, `public/game.js`, `README.md`, bộ test (`test/`).

---

## 1. Rương không còn hiện trên màn hình chủ phòng

Màn hình chủ phòng được chiếu cho cả lớp, nên rương bị ẩn ở **cả hai lớp** để không thể lộ bằng cách mở DevTools:

| Chỗ | Trước | Sau |
| --- | --- | --- |
| `server.js` – gói tin `round` | gửi `treasure` cho mọi người | chỉ gửi cho người chơi, chủ phòng không nhận trường `treasure` |
| `server.js` – gói tin `init` (vào giữa ván) | gửi `treasure` cho mọi người | tương tự, chủ phòng không nhận |
| `public/game.js` – `render()` | chủ phòng thấy rương giữa bản đồ | không vẽ rương khi `role === 'host'` |
| `public/game.js` – `renderMinimap()` | có chấm đánh dấu rương | bỏ hẳn chấm rương |

Vì sao chặn ở cả server lẫn client: client tự kiểm tra lại vai trò, nên khi quyền chủ phòng được chuyển giữa ván (giáo viên thoát, người kế tiếp lên chủ phòng), người đó vẫn có thể còn giữ vị trí rương cũ trong bộ nhớ — client sẽ không vẽ. Test `test/client.js` có ca "chủ phòng bỏ qua vị trí rương dù có được gửi".

Người chơi không thay đổi gì: vẫn thấy rương khi ở trong bán kính 4,5 ô và vẫn có mũi tên chỉ hướng rương.

Chủ phòng vẫn theo dõi được diễn biến: khung **DIỄN BIẾN** báo "… TÌM THẤY RƯƠNG", bảng xếp hạng vẫn hiện điểm và trạng thái đúng/đóng băng.

> Lưu ý còn lại: màn hình chủ phòng vẫn hiện **vị trí của tất cả người chơi** (đúng như bạn muốn). Khi người đầu tiên tới rương, cả lớp nhìn màn hình sẽ thấy điểm dừng đó trên bản đồ — tức là sau khi có người tìm ra, vị trí rương bị lộ gián tiếp cho những bạn còn đang tìm. Nếu muốn bịt tiếp, có thể: ẩn luôn người đã chạm rương, hoặc làm mờ/trễ lớp người chơi vài giây. Nói một tiếng là tôi làm.

---

## 2. Số đo thật với 50 người chơi

Bộ đo mới: `test/load.js` (`npm run load`) — 1 chủ phòng + 50 người chơi, mỗi máy gửi vị trí đúng nhịp thật của client (66 ms/gói) trong 6 giây. Đo trên máy này (Node 22); máy chủ thật yếu hơn thì CPU sẽ cao hơn nhưng băng thông thì không đổi.

| Chỉ số (50 người chơi + 1 chủ phòng, tất cả cùng di chuyển) | Trước | Sau |
| --- | --- | --- |
| Mỗi máy học sinh tải về | **40,5 KB/s** (750 gói/s) | **~0 KB/s** |
| Máy chủ phòng tải về | 40,5 KB/s | 40,6 KB/s (751 gói/s) |
| Tổng lưu lượng cả lớp / 10 s | **20,7 MB** | **0,4 MB** |
| CPU server | 27% một lõi | **6% một lõi** |
| Độ trễ `/health` p95 | 5–7 ms | 1–2 ms |
| 50 máy vào phòng cùng lúc | ~0,6 s, không máy nào bị rớt | như cũ |

Lý do: người chơi không nhìn thấy nhau, nên server chỉ cần gửi vị trí cho chủ phòng (`broadcastState`). Trước đây server phát vị trí của mọi người cho mọi người rồi client tự ẩn — vừa tốn Wi-Fi 50 lần, vừa để lộ vị trí qua DevTools.

Kích thước gói (50 người): vào phòng ~10 KB; đầu mỗi vòng ~9,8 KB (mê cung + danh sách 50 người) — cả lớp ~250 KB một lần khi bắt đầu vòng, sau đó gần như im lặng. Với Wi-Fi lớp học, đây là mức thoải mái.

---

## 3. Rủi ro còn lại khi có 50 người chơi

Xếp theo mức độ. Cột "xử lý" ghi rõ cái nào tôi **chưa** đổi (vì là luật chơi/ý bạn quyết).

### 🔴 A. Luật "5 người trả lời đúng là hết vòng" phá vỡ trải nghiệm đông người

Đường đúng dài 30–70 ô, tốc độ 5,5 ô/giây ⇒ người nhanh nhất chạm rương sau ~13–20 giây, và vòng kết thúc ngay khi có **5** người đúng. Với 50 học sinh, phần lớn học sinh:

- chưa kịp tới rương thì vòng đã hết → không bao giờ được trả lời;
- điểm gần như chỉ thuộc về 5 bạn nhanh nhất, các vòng sau lặp lại một nhóm;
- học sinh còn lại có 60 giây chơi nhưng phần "trả lời câu hỏi" (phần học thuật) lại không tới lượt.

**Xử lý (chưa đổi, chờ bạn xác nhận luật):** cho số người thắng tối đa co giãn theo sĩ số, ví dụ `maxCorrect = Math.max(5, Math.ceil(countPlayers() * 0.2))` → 50 người = 10 người đúng mới hết vòng; hoặc bỏ hẳn kết thúc sớm và chờ đủ 60 giây. Đổi luật chỉ ảnh hưởng `MAX_CORRECT` ở `server.js` và dòng chữ trong README.

### 🟠 B. Người vào phòng đầu tiên là chủ phòng

Nếu bạn chưa mở link mà một học sinh vào trước, bạn ấy thành chủ phòng: không được chơi, lại có quyền bắt đầu/qua màn/chơi ván mới/reset ván. Với 50 học sinh cùng mở link, rủi ro này cao hơn hẳn so với lớp 5–10 người.

**Xử lý:** bạn luôn mở link trên máy chiếu trước khi phát link cho lớp. Nếu muốn chắc, tôi thêm mã PIN cho chủ phòng (nhập khi vào lần đầu).

### 🟠 C. Mất mạng / tải lại trang = mất điểm, và có "người chơi ma"

Học sinh rớt Wi-Fi hoặc lỡ tải lại trang sẽ tạo lượt mới, **mất toàn bộ điểm cũ** (đã ghi trong README). Lượt cũ chỉ biến mất khi server phát hiện socket chết — cơ chế ping hiện tại là 30 giây/lần, tối đa ~60 giây mới dọn. Trong lúc đó sĩ số phòng, bảng điểm vẫn tính người ma, và nếu người ma là chủ phòng thì mất ~60 giây mới chuyển quyền.

**Xử lý:** chấp nhận (lớp học, ván ngắn) hoặc giảm ping xuống 10 giây (một dòng trong `server.js`) hoặc làm cơ chế "kết nối lại giữ điểm" bằng token lưu ở client. Cái cuối là việc lớn hơn.

### 🟡 D. Trùng tên — **đã xử lý**

Lớp 50 người chắc chắn có bạn trùng tên. Người vào sau giờ được thêm hậu tố ` 2`, ` 3`… (`uniqueName` trong `server.js`), nên bảng điểm và khung diễn biến phân biệt được. Tên vẫn tối đa 16 ký tự.

### 🟡 E. Xem lén bằng DevTools

Client vẫn phải giữ vị trí rương trong bộ nhớ để vẽ rương và mũi tên, nên học sinh mở DevTools có thể đọc ra vị trí rương (đáp án thì an toàn: server chỉ công bố đáp án đúng ở màn review). Ngoài ra biên độ kiểm tra tốc độ trên server là ~6,5 ô/giây, cao hơn tốc độ thật 5,5 nên client sửa được có thể đi nhanh hơn ~18%.

**Xử lý:** chấp nhận (giáo viên nhắc lớp), hoặc làm chặt hơn: server chỉ gửi toạ độ rương khi người chơi thật sự ở trong tầm nhìn, còn lại chỉ gửi góc hướng; và hạ biên độ kiểm tra tốc độ về sát 5,5. Tôi có thể làm nếu bạn cần.

### 🟡 F. Bảng xếp hạng HUD chỉ hiện 6 người

Trong vòng đấu, HUD chỉ hiện top 6 nên học sinh xếp thứ 20–50 không biết thứ hạng của mình (vẫn thấy điểm cá nhân ở thanh dưới). Bảng review/cuối ván hiện đủ 50 và có thanh cuộn nên không bị cắt.

**Xử lý (chưa đổi):** thêm dòng "HẠNG 27/50" vào thanh trạng thái người chơi — sửa nhỏ trong `updateLeaderboard`/`updateStatusChip`.

### ⚪ G. Chi tiết nhỏ, không gấp

- **50 nhân vật cùng một điểm xuất phát**: không va vào nhau (server không kiểm tra va chạm giữa người với người), nhưng nhãn tên chồng lên nhau ở giây đầu của vòng. Muốn gọn hơn thì cho mỗi bạn lệch ±0,2 ô trong cùng ô xuất phát (phải giữ dưới 0,22 ô kẻo kẹt tường, vì bán kính nhân vật là 0,28 ô).
- **Log server có in vị trí rương** (`[round 1] started, treasure at (11.5,9.5)`). Nếu cửa sổ terminal cũng chiếu lên máy chiếu thì nên tắt dòng đó.
- **Bản đồ nhỏ (`minimap`) đang là mã chết**: `updateRoleUI()` luôn đặt `hidden = true` cho `.minimap-wrap`, nên khung "BẢN ĐỒ" không bao giờ hiện với ai, dù `renderMinimap()` vẫn vẽ mỗi 5 khung hình cho chủ phòng. Tôi giữ nguyên hành vi (ẩn) vì nếu bật lên thì nó lại lộ rương ở bản đồ nhỏ. Có thể xoá hẳn hoặc bật lại cho chủ phòng mà không có chấm rương.
- **Không có giới hạn hàng đợi gửi (`bufferedAmount`)**: nếu mạng máy chủ phòng nghẽn, 750 gói/s sẽ được đệm trong RAM server thay vì bỏ bớt. Ở mức 40 KB/s thì vài chục giây nghẽn cũng chỉ vài MB — chưa đáng lo, nhưng nên biết.
- Các phần khác đã kiểm tra và **không có vấn đề** ở 50 người: bộ nhớ `players` xoá đúng khi socket đóng; mọi vòng lặp server là O(số người) và chỉ chạy khi có sự kiện; `feed` giới hạn 6 dòng; đồng hồ vòng dùng `setTimeout` một lần; không có rò rỉ timer; tên người chơi được lọc ký tự điều khiển và render bằng `textContent` (không có XSS).

---

## 4. Đã chạy lại kiểm tra

```
npm test    # maze, client, smoke, disconnect — tất cả PASS
npm run load   # 50 người chơi: máy học sinh ~0 KB/s, host 41 KB/s, p95 1–2ms
```

Test mới bổ sung: chủ phòng không vẽ rương (kể cả khi bị gửi toạ độ), server không gửi `treasure` cho chủ phòng nhưng vẫn gửi cho người chơi, người chơi không nhận vị trí của nhau, chủ phòng vẫn nhận đủ 50 người, trùng tên được thêm hậu tố.
