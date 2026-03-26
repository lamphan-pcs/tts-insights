# TikTok Product Exporter (Official API Proxy)

Small React + Tailwind tool that:

- Fetches all allowed product fields from TikTok Shop Open API.
- Keeps price and origin_price visible in exported data.
- Shows data in an adjustable table (resizable columns).
- Copies all rows as tab-separated values ready for Google Sheets / Excel paste.

## Stack

- React + Vite
- Tailwind CSS (via @tailwindcss/vite)
- Express proxy server for official API requests and signing
- react-data-grid for adjustable columns

## Quick Start

1. Install dependencies

	npm install

2. Create env file

	copy .env.example .env

3. Start both frontend and backend

	npm run dev

4. Open

	http://localhost:5173

## How It Works

- The browser sends credentials to the local backend endpoint /api/products/fetch.
- Backend signs requests and calls TikTok Open API products endpoint.
- Backend auto-paginates via page_token when available.
- Frontend flattens nested objects into columns so all allowed details are visible.

## Notes for TikTok API

- Endpoint path defaults to /product/202309/products/search. Change it in the UI if your app uses another version/path.
- Some TikTok tenants use slightly different signing expectations. Sign Mode in the UI allows:
  - dual: try v1 then v2
  - v1
  - v2
- If your endpoint expects a different request body format, edit Request Body JSON directly in the UI.

## In-App OAuth Token Helper

This app now includes OAuth helper controls so you can get and refresh tokens without leaving the tool:

1. Fill App Key, App Secret, Auth URL, Redirect URI.
2. Click "1) Start OAuth" and complete seller authorization.
3. On redirect back, the app auto-captures auth code from URL query.
4. Click "2) Exchange Code" to retrieve access_token and refresh_token.
5. Click "3) Refresh Token" when access token expires.

If your region/tenant uses different endpoints, update:

- Token Path (default: /authorization/202309/token/get)
- Refresh Path (default: /authorization/202309/token/refresh)
- Auth URL (default: https://services.tiktokshop.com/open/authorize)

Optional server defaults are supported via .env:

- TIKTOK_AUTH_URL
- TIKTOK_TOKEN_PATH
- TIKTOK_REFRESH_PATH

## Export Behavior

- Copy All button copies header + all rows as TSV.
- Paste directly into Google Sheets or Excel.

## Security

- Do not commit .env or real API credentials.
- This project is for your own authorized TikTok Shop data access only.
