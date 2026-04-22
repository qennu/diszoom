# Diszoom

Diszoom — это self-hosted realtime‑платформа в стиле Discord + Zoom:

- текстовые и медиа‑каналы внутри «серверов» (сообществ);
- WebRTC-видеосвязь через **SFU** на базе **mediasoup**;
- REST API + SSE + WebSocket signaling;
- хранение бизнес‑состояния приложения в PostgreSQL и файловое хранение служебных данных медиа‑части.

---

## 1) Что внутри проекта

## Backend (Node.js)

Backend поднимает HTTPS‑сервер на Express и подключает:

1. **App API** (`/app/*`) — логика Diszoom:
   - регистрация/логин;
   - серверы, каналы, роли, инвайты;
   - сообщения и вложения;
   - realtime-события через SSE (`/app/events`).
2. **SFU/инфраструктурный API**:
   - `/health`, `/ice`, `/metrics`;
   - admin‑операции с постоянными и сессионными комнатами (`/rooms/*`).
3. **WebSocket signaling** (`/ws`) для mediasoup‑клиентов:
   - `createWebRtcTransport`, `connectWebRtcTransport`, `produce`, `consume`, `resume` и т.д.

## Frontend (React)

SPA в `client/` (React + mediasoup-client), собирается esbuild’ом в `public/`:

- интерфейс серверов/каналов/участников;
- текстовый чат с вложениями (data URLs);
- подключение к медиа‑каналу (аудио/видео);
- настройка устройств (микрофон/камера), локальные пользовательские настройки в `localStorage`.

---

## 2) Технологический стек и библиотеки

### Основные runtime-зависимости

- **express** — HTTP API и статика.
- **ws** — WebSocket‑сервер signaling.
- **mediasoup** — SFU на сервере.
- **mediasoup-client** — WebRTC/SFU клиент в браузере.
- **react / react-dom** — UI клиента.
- **pg** — PostgreSQL (хранение app state).

### Инструменты сборки

- **esbuild** — бандлинг фронтенда (`npm run build:client`).

### Протоколы и коммуникации

- **HTTPS** для REST/SSE/статики;
- **WSS** для signaling;
- **WebRTC** для media plane;
- **SSE** для app‑событий (изменения серверов, каналов, сообщений, медиа‑присутствия).

---

## 3) Архитектура (как устроен diszoom)

## 3.1 Уровни данных

Проект использует два независимых хранилища:

1. **PostgreSQL (`app_state`)** — пользовательская бизнес‑модель:
   - users, sessions, servers, roles, members, channels, invites, messages.
2. **Файловое хранилище (`data/*.json`)** — состояние SFU‑комнат:
   - постоянные и сессионные комнаты, audit events.

Это упрощает доменную часть приложения (социальный слой) и media‑слой (транспорт/комнаты) без жесткой связанности.

## 3.2 Комнаты и каналы

- Для media‑канала создаётся постоянная media‑комната с `roomId = <serverId>-<channelId>`.
- Серверу назначается `mediaJoinToken`; он пробрасывается в `allowedTokens` комнаты.
- Удаление media‑канала или сервера вызывает удаление соответствующей комнаты и закрытие роутера SFU.

## 3.3 Безопасность и доступ

- App API использует собственные bearer‑сессии (`/app/login`, `/app/register`).
- Admin‑часть (`/rooms/*`, `/metrics`) защищается `ADMIN_TOKEN`.
- Доступ к SFU‑комнате проверяется по `allowedTokens` / `joinToken` / admin token.

---

## 4) Backend подробно

## 4.1 Точка входа

`src/server.js`:

- создаёт `express` + `https.createServer`;
- подключает `registerAppRoutes`, `registerRoutes`, `registerWebSocket`;
- инициализирует `mediasoup`, app store и комнаты с диска;
- планирует TTL‑очистку сессионных комнат.

## 4.2 REST API

### Публичные

- `GET /health`
- `GET /ice`

### Админские (через `ADMIN_TOKEN`)

- `GET /metrics`
- `GET/POST/DELETE /rooms/permanent`
- `POST /rooms/permanent/:id/tokens`
- `GET/POST /rooms/session`
- `POST /rooms/session/:id/token/rotate`
- `POST /rooms/session/:id/close`

### App API (`/app/*`)

- Auth: `register`, `login`, `me`.
- Servers: создание, список, детали, посещения.
- Channels: добавление/удаление.
- Roles & permissions: создание ролей, назначение роли участнику.
- Invites: создание и вступление по коду.
- Messages: чтение/создание сообщений.
- Media peers: онлайн‑участники media‑канала.
- Realtime events: `GET /app/events` (SSE).

## 4.3 WebSocket signaling

Поддерживаемые actions:

- `getRouterRtpCapabilities`
- `getProducers`
- `getPeers`
- `createWebRtcTransport`
- `connectWebRtcTransport`
- `produce`
- `closeProducer`
- `consume`
- `resume`

Нотификации в комнате:

- `peerJoined` / `peerLeft`
- `newProducer`
- `producerClosed`

## 4.4 Метрики и аудит

- In-memory счётчики HTTP/WS/auth.
- Экспорт Prometheus‑style plain text на `/metrics`.
- Audit log в `data/events.log` (JSON lines).

---

## 5) Frontend подробно

Фронтенд (`client/app.jsx`) — single-page интерфейс в духе Discord:

- sidebar с серверами и поиском;
- список каналов (text/media);
- центральная панель сообщений и/или медиа‑плитка;
- панель участников и контекстное управление громкостью пользователя;
- модальные окна: auth, создание сервера, канала, ролей, инвайтов, settings.

### Media flow на клиенте

1. Подключение к `/ws?roomId=...&token=...`.
2. Получение RTP capabilities.
3. Создание send/recv transport.
4. Публикация локальных треков (`produce`).
5. Подписка на удалённые продьюсеры (`consume` + `resume`).

### UI и стили

- Основной стиль в `client/style.css` (тёмная тема, карточная сетка, responsive блоки).
- Шрифты: Outfit и Orbitron.

---

## 6) Структура репозитория

- `src/` — backend (API, auth, mediasoup manager, storage, ws).
- `client/` — исходники SPA.
- `public/` — собранный клиент для раздачи Express.
- `data/` — runtime JSON и audit events.
- `turn/` — пример конфигурации coturn + docker compose.
- `scripts/build-client.mjs` — сборка фронта.

---

## 7) Запуск локально

## Требования

- Node.js 18+
- PostgreSQL (по умолчанию БД `diszoom`)
- TLS‑сертификат и ключ

## Шаги

```bash
npm install
npm run build:client
npm start (альтерн. pm2 start myapp)
```

После запуска приложение доступно по HTTPS на порту `PORT` (по умолчанию `443`).

---

## 8) Переменные окружения

### Общие

- `PORT` (по умолчанию `443`)
- `DATA_DIR` (по умолчанию `data`)
- `ADMIN_TOKEN`
- `ALLOW_ANON_PERMANENT` (`true|false`)
- `ALLOW_ANON_SESSION` (`true|false`)
- `SESSION_TTL_MIN`

### ICE/TURN

- `ICE_SERVERS_JSON` или `ICE_SERVERS` (JSON-массив)

Если не задано — используется `stun:stun.l.google.com:19302`.

### Mediasoup

- `MEDIASOUP_LISTEN_IP`
- `MEDIASOUP_ANNOUNCED_IP`
- `MEDIASOUP_RTC_MIN_PORT`
- `MEDIASOUP_RTC_MAX_PORT`
- `MEDIASOUP_INITIAL_AVAILABLE_OUTGOING_BITRATE`
- `MEDIASOUP_MAX_INCOMING_BITRATE`
- `MEDIASOUP_WORKER_LOG_LEVEL`
- `MEDIASOUP_WORKER_LOG_TAGS`

### PostgreSQL

Можно через `DATABASE_URL` (предпочтительно) или по отдельности:

- `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSL`

---

## 9) TURN

В репозитории есть пример для coturn:

- `turn/turnserver.conf`
- `turn/docker-compose.turn.yml`

---
