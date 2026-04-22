# DisZoom

Сервер реализован на **mediasoup** (SFU) и поддерживает два типа комнат:

- **Постоянные комнаты** (как в Discord): сохраняются на диск.
- **Сессионные комнаты** (как в Zoom): имеют TTL, автоматически закрываются и тоже сохраняются на диск.

Дополнительно:

- авторизация и ACL;
- аудит‑лог и метрики;
- endpoint выдачи ICE‑серверов + пример настройки TURN;
- простой веб‑клиент (mediasoup‑client).

## Запуск

```bash
npm install
npm run build:client
pm2 start myapp
```

После запуска клиент доступен на `https://diszoom.ru/`.

## Переменные окружения

- `PORT` (по умолчанию `8080`)
- `DATA_DIR` (по умолчанию `data`)
- `SESSION_TTL_MIN` (по умолчанию `120`)
- `ADMIN_TOKEN` (если не задан, admin‑эндпоинты будут открыты)
- `ALLOW_ANON_PERMANENT` (`true/false`, по умолчанию `false`)
- `ALLOW_ANON_SESSION` (`true/false`, по умолчанию `false`)
- `ICE_SERVERS` или `ICE_SERVERS_JSON` (JSON‑массив iceServers)

Mediasoup:

- `MEDIASOUP_LISTEN_IP` (по умолчанию `0.0.0.0`)
- `MEDIASOUP_ANNOUNCED_IP` (если сервер за NAT)
- `MEDIASOUP_INITIAL_AVAILABLE_OUTGOING_BITRATE` (по умолчанию `1000000`)
- `MEDIASOUP_MAX_INCOMING_BITRATE` (по умолчанию `0`)
- `MEDIASOUP_WORKER_LOG_LEVEL` (по умолчанию `warn`)
- `MEDIASOUP_WORKER_LOG_TAGS` (список через запятую)

Пример `ICE_SERVERS`:

```json
[
  { "urls": ["stun:stun.l.google.com:19302"] },
  { "urls": ["turn:turn.example.com:3478"], "username": "webrtc", "credential": "secret" }
]
```

## Авторизация и ACL

- Все admin‑эндпоинты требуют `Authorization: Bearer <ADMIN_TOKEN>`.
- Для WebSocket подключений требуется `token` в query‑string.
- Для постоянных комнат:
  - если `allowedTokens` пуст, доступ только при `ALLOW_ANON_PERMANENT=true` или admin‑токене;
  - если `allowedTokens` задан, токен должен быть в списке.
- Для сессионных комнат:
  - создается `joinToken`, он же нужен для подключения.

## REST API (требует `ADMIN_TOKEN`)

- `GET /rooms/permanent`
- `POST /rooms/permanent` `{ "id"?, "name"?, "allowedTokens"? }`
- `POST /rooms/permanent/:id/tokens` `{ "tokens": ["t1", "t2"] }`
- `DELETE /rooms/permanent/:id`
- `GET /rooms/session`
- `POST /rooms/session` `{ "name"?, "ttlMinutes"? }`
- `POST /rooms/session/:id/token/rotate`
- `POST /rooms/session/:id/close`
- `GET /metrics`

Публичные:

- `GET /health`
- `GET /ice`

## WebSocket (mediasoup signaling)

Подключение:

```
ws://<host>:<port>/ws?roomId=<roomId>&token=<token>
```

Формат запросов (request/response):

```
{ "id": 1, "action": "getRouterRtpCapabilities", "data": {} }
{ "id": 2, "action": "createWebRtcTransport", "data": {} }
{ "id": 3, "action": "connectWebRtcTransport", "data": { "transportId": "...", "dtlsParameters": { ... } } }
{ "id": 4, "action": "produce", "data": { "transportId": "...", "kind": "audio", "rtpParameters": { ... } } }
{ "id": 5, "action": "consume", "data": { "transportId": "...", "producerId": "...", "rtpCapabilities": { ... } } }
{ "id": 6, "action": "resume", "data": { "consumerId": "..." } }
{ "id": 7, "action": "getProducers", "data": {} }
```

Ответы:

```
{ "id": 1, "ok": true, "data": { ... } }
{ "id": 2, "ok": false, "error": "..." }
```

Нотификации:

- `newProducer`
- `producerClosed`
- `peerJoined`
- `peerLeft`

## Клиент

Исходники клиента находятся в `client/`. Для сборки:

```bash
npm run build:client
```

## Аудит‑лог и метрики

- Лог событий: `data/events.log` (JSON‑lines)
- Метрики: `GET /metrics` (требует `ADMIN_TOKEN`)

## TURN (пример)

Файлы для coturn:

- `turn/turnserver.conf`
- `turn/docker-compose.turn.yml`
