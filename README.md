# Mini Voice

Ứng dụng chat voice nhẹ cho **2–10 người**, nhẹ hơn Discord, **miễn phí** ở giai đoạn đầu.

## Tính năng

- **WebRTC P2P** — audio/video trực tiếp giữa các máy (chỉ signaling qua server)
- **Socket.io** — signaling + chat text theo phòng
- **STUN Google** — `stun:stun.l.google.com:19302`
- Mute mic, bật/tắt camera (video **tắt mặc định**)
- Danh sách thành viên, link mời `?room=...`
- **Push-to-talk** — giữ `Space` để nói
- Audio ~**32 kbps**, noise suppression + Web Audio compressor

## Chạy local

```bash
cd mini-voice-chat
npm run install:all
npm run dev
```

- Frontend: http://localhost:5173  
- Signaling server: http://localhost:3001  

Mở 2 tab trình duyệt, cùng mã phòng, cho phép micro.

## Cấu trúc

```
mini-voice-chat/
  server/     # Node + Express + Socket.io (~80 dòng)
  client/     # React + Vite + WebRTC mesh
```

## Lưu ý

- **NAT/firewall**: một số mạng cần TURN server (có phí) để P2P hoạt động; STUN miễn phí đủ cho nhiều trường hợp LAN/cùng ISP.
- Mesh 10 người = tối đa 9 kết nối/máy — phù hợp nhóm nhỏ, không scale như Discord.

## Production (tùy chọn)

```bash
npm run build
npm start
```

Serve `client/dist` từ server sau khi build.
