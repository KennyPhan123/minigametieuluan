# Mê cung Hasaki — Mini game online

Game web multiplayer: 10 kho báu giấu trong một mê cung cửa hàng Hasaki. Người chơi di chuyển tự do, tìm kho báu, trả lời đúng 10 câu hỏi để thắng.

## Chức năng

- **Mê cung đen trắng** cổ điển, render Canvas, góc nhìn từ trên xuống, zoom gần nhân vật (có sương mù trắng — không thấy quá nhiều map cùng lúc)
- **Di chuyển tự do** (không theo block): joystick ảo trên điện thoại, phím WASD / mũi tên trên laptop
- **10 kho báu** (hình viên kim cương) đặt ở các góc/ngõ cụt của mê cung — chạm vào để mở câu hỏi
- **10 câu hỏi** về Hasaki với 4 phương án A/B/C/D; chọn sai bị gạch và chọn lại được; chọn đúng thì thu thập kho báu
- **Multiplayer realtime**: mọi người chơi cùng một mê cung, thấy nhau di chuyển, bảng xếp hạng tiến độ trực tuyến
- **Chiến thắng**: ai thu thập đủ 10 kho báu trước — tất cả đều thấy thông báo; nút "Ván mới" để chơi lại
- **Bản đồ nhỏ**: chỉ hiện vùng đã khám phá + vị trí người chơi + kho báu đã thu
- **Tiếp tục lại sau mất kết nối**: tiến độ được lưu (localStorage) theo từng ván

## Design

- Không emoji, tông trắng/đen sáng sủa, giao diện simple & modern
- Font system stack, viền đen mảnh, bo góc nhẹ, tương phản cao

## Chạy game

```bash
npm install
npm start          # server chạy tại http://localhost:3000
```

Mở trình duyệt trên điện thoại/laptop (cùng mạng) truy cập `http://<ip-máy>:3000`.

## Test

```bash
npm test           # maze test + client playthrough test + multiplayer smoke test
```

## Cấu trúc

```
server.js          # HTTP static + WebSocket realtime + sinh mê cung (chung cho mọi người chơi)
maze.js            # thuật toán sinh mê cung (recursive backtracker) + chọn vị trí kho báu
public/index.html  # giao diện: màn hình vào game, HUD, modal câu hỏi, overlay thắng
public/style.css   # style trắng đen hiện đại
public/game.js     # client: render, di chuyển, va chạm, camera, joystick, realtime
public/questions.js# bộ 10 câu hỏi (đáp án + chú thích)
test/              # maze / client / smoke test
```

## Giao thức WebSocket (tóm tắt)

| Hướng | Message | Ý nghĩa |
|---|---|---|
| C → S | `{type:'join', name}` | vào game |
| C → S | `{type:'state', x, y, fx, fy}` | gửi vị trí ~15 lần/giây |
| C → S | `{type:'progress', collected:[ids]}` | gửi danh sách kho báu đã thu |
| C → S | `{type:'restart'}` | bắt đầu ván mới |
| S → C | `{type:'init', ...}` | mê cung, kho báu, danh sách người chơi |
| S → C | `{type:'joined'/'left'/'state'/'progress'}` | đồng bộ những người khác |
| S → C | `{type:'won', id, name}` | có người thắng |
| S → C | `{type:'restart', gameId, players}` | ván mới cho tất cả |
