# Electron Desktop Client Design

## Tech Stack
- Vite + React 18 + TypeScript
- Ant Design 5 (UI components)
- HashRouter (React Router v6)
- react-i18next (zh/ru bilingual)
- Axios (HTTP, JWT interceptor)
- electron + electron-builder

## Project Structure

```
SalesDesktop/
├── electron/
│   └── main.ts           # Electron main process
├── src/
│   ├── api/              # Axios instance + per-module API functions
│   ├── components/       # Shared components (AuthRoute, etc.)
│   ├── i18n/             # zh.json / ru.json
│   ├── layouts/          # AppLayout (sidebar + header)
│   ├── pages/            # 9 page modules
│   ├── hooks/            # Custom hooks (useAuth, etc.)
│   ├── utils/            # Helpers
│   ├── App.tsx           # Router + AuthProvider
│   └── main.tsx          # Entry
├── package.json
├── vite.config.ts
└── electron-builder.yml
```

## Routes (HashRouter)

| Path | Page | API Endpoint |
|------|------|-------------|
| `/login` | Login | `POST /api/v2/auth/login` |
| `/` | Dashboard | `GET /api/v2/dashboard/overview` |
| `/weighing` | Weighing List | `GET /api/v2/weighing/list` |
| `/weighing/verify` | Weighing Verify | `POST /api/v2/weighing/verify` |
| `/train-entry` | Train Entry | `GET/POST /api/v2/train-entry/*` |
| `/wholesale` | Wholesale | `GET /api/v2/wholesale/*` |
| `/procurement` | Procurement | `GET /api/v2/procurement/*` |
| `/contracts` | Contracts | `GET/POST/PUT /api/v2/contracts/*` |
| `/materials` | Materials | `GET/POST/PUT /api/v2/materials/*` |
| `/transfer-loss` | Transfer Loss | `GET /api/v2/transfer-loss/*` |
| `/users` | User Management | `GET/POST/PUT /api/v2/users/*` |

## Auth Flow
1. Login → store `accessToken` in `localStorage`
2. Axios interceptor injects `Authorization: Bearer <token>`
3. 401 response → clear token → redirect `/login`
4. Unauthenticated → only `/login` accessible; Authenticated → `/login` redirects to `/`

## JWT
- `accessToken` 存在 `localStorage`
- 每次请求 Axios request interceptor 注入 header
- 401 时 Axios response interceptor 清除 token 并跳到登录页

## Implementation Order
1. Scaffold (Vite + deps + electron config)
2. Layout (sidebar + header with i18n toggle)
3. Auth (Login page + AuthProvider + Axios interceptor)
4. Dashboard page
5. Weighing list + verify page
6. Remaining pages (skeleton first, fill later)
