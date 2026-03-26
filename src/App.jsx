import { useEffect, useMemo, useState } from "react";
import { DataGrid } from "react-data-grid";

function getBrowserOrigin() {
    if (typeof window === "undefined") {
        return "http://localhost:5173";
    }

    return window.location.origin;
}

const DEFAULTS = {
    baseUrl: "https://open-api.tiktokglobalshop.com",
    productsPath: "/product/202309/products/search",
    authUrl: "https://services.tiktokshop.com/open/authorize",
    tokenPath: "/authorization/202309/token/get",
    refreshPath: "/authorization/202309/token/refresh",
    redirectUri: getBrowserOrigin(),
    appKeyParam: "app_key",
    oauthScope: "",
    oauthExtraQuery: "{}",
    appKey: "",
    appSecret: "",
    accessToken: "",
    shopCipher: "",
    pageSize: 100,
    maxPages: 20,
    signMode: "dual",
    extraQuery: '{\n  "version": "202309"\n}',
    requestBody: '{\n  "status": "ACTIVATE"\n}',
};

const pricePriority = [
    "product_id",
    "id",
    "product_name",
    "title",
    "name",
    "price",
    "sale_price",
    "origin_price",
    "original_price",
];

function parseJsonField(input, fallback = {}) {
    if (!input?.trim()) return fallback;
    return JSON.parse(input);
}

function flattenRecord(value, prefix = "", acc = {}) {
    if (value === null || value === undefined) {
        if (prefix) acc[prefix] = "";
        return acc;
    }

    if (Array.isArray(value)) {
        if (prefix) acc[prefix] = JSON.stringify(value);
        return acc;
    }

    if (typeof value !== "object") {
        if (prefix) acc[prefix] = value;
        return acc;
    }

    for (const [key, nested] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (nested && typeof nested === "object" && !Array.isArray(nested)) {
            flattenRecord(nested, path, acc);
            continue;
        }

        if (Array.isArray(nested)) {
            acc[path] = JSON.stringify(nested);
            continue;
        }

        acc[path] = nested ?? "";
    }

    return acc;
}

function toTsvValue(value) {
    if (value === null || value === undefined) return "";
    const base =
        typeof value === "object" ? JSON.stringify(value) : String(value);
    return base.replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function sortColumns(keys) {
    const priority = new Map(pricePriority.map((key, index) => [key, index]));
    return [...keys].sort((a, b) => {
        const left = priority.has(a)
            ? priority.get(a)
            : Number.MAX_SAFE_INTEGER;
        const right = priority.has(b)
            ? priority.get(b)
            : Number.MAX_SAFE_INTEGER;
        if (left !== right) return left - right;
        return a.localeCompare(b);
    });
}

function asDetailMessage(value) {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "string") return value;

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function toErrorMessage(json, fallbackMessage) {
    const detail = asDetailMessage(json?.detail);
    if (json?.error && detail) {
        return `${json.error} ${detail}`;
    }

    return json?.error || detail || fallbackMessage;
}

function App() {
    const [form, setForm] = useState(DEFAULTS);
    const [rows, setRows] = useState([]);
    const [columns, setColumns] = useState([]);
    const [authCode, setAuthCode] = useState("");
    const [refreshToken, setRefreshToken] = useState("");
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [oauthLoading, setOauthLoading] = useState(false);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const callbackCode = params.get("auth_code") || params.get("code");
        const oauthError = params.get("error") || params.get("error_message");

        if (callbackCode) {
            setAuthCode(callbackCode);
            setStatus(
                "Authorization code captured from callback. Click Exchange Code to get the access token.",
            );
        }

        if (oauthError) {
            setError(`OAuth callback returned an error: ${oauthError}`);
        }

        if (callbackCode || oauthError) {
            ["auth_code", "code", "state", "error", "error_message"].forEach(
                (key) => params.delete(key),
            );

            const nextQuery = params.toString();
            const nextUrl = `${window.location.pathname}${
                nextQuery ? `?${nextQuery}` : ""
            }${window.location.hash}`;
            window.history.replaceState({}, "", nextUrl);
        }
    }, []);

    const gridColumns = useMemo(
        () => [
            {
                key: "__rowId",
                name: "#",
                width: 60,
                resizable: false,
                frozen: true,
            },
            ...columns.map((key) => ({
                key,
                name: key,
                minWidth: 160,
                resizable: true,
                sortable: true,
            })),
        ],
        [columns],
    );

    const setField = (field) => (event) => {
        const value = event.target.value;
        setForm((previous) => ({ ...previous, [field]: value }));
    };

    const fetchProducts = async () => {
        setError("");
        setStatus("");
        setLoading(true);

        try {
            const payload = {
                ...form,
                pageSize: Number(form.pageSize),
                maxPages: Number(form.maxPages),
                extraQuery: parseJsonField(form.extraQuery, {}),
                requestBody: parseJsonField(form.requestBody, {}),
            };

            const response = await fetch("/api/products/fetch", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const json = await response.json();
            if (!response.ok) {
                throw new Error(
                    json.error || "Failed to fetch products from TikTok API.",
                );
            }

            const fetchedProducts = Array.isArray(json.products)
                ? json.products
                : [];
            const flatRows = fetchedProducts.map((product, index) => ({
                __rowId: index + 1,
                ...flattenRecord(product),
            }));

            const keySet = new Set();
            for (const row of flatRows) {
                Object.keys(row)
                    .filter((key) => key !== "__rowId")
                    .forEach((key) => keySet.add(key));
            }

            const orderedColumns = sortColumns([...keySet]);
            setRows(flatRows);
            setColumns(orderedColumns);
            setStatus(
                `${json.totalProducts ?? flatRows.length} products loaded from ${json.pagesFetched ?? 1} page(s).`,
            );
        } catch (caught) {
            setRows([]);
            setColumns([]);
            setError(
                caught.message || "Unexpected error while fetching products.",
            );
        } finally {
            setLoading(false);
        }
    };

    const startOauth = async () => {
        setError("");
        setStatus("");
        setOauthLoading(true);

        try {
            if (!form.appKey) {
                throw new Error("App Key is required before starting OAuth.");
            }

            if (!form.redirectUri) {
                throw new Error(
                    "Redirect URI is required before starting OAuth.",
                );
            }

            const payload = {
                appKey: form.appKey,
                redirectUri: form.redirectUri,
                authUrl: form.authUrl,
                appKeyParam: form.appKeyParam || "app_key",
                scope: form.oauthScope,
                extraQuery: parseJsonField(form.oauthExtraQuery, {}),
            };

            const response = await fetch("/api/oauth/authorize-url", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const json = await response.json();
            if (!response.ok || !json.url) {
                throw new Error(
                    toErrorMessage(
                        json,
                        "Failed to build TikTok authorization URL.",
                    ),
                );
            }

            window.location.assign(json.url);
        } catch (caught) {
            setError(caught.message || "Unable to start OAuth flow.");
        } finally {
            setOauthLoading(false);
        }
    };

    const exchangeAuthCode = async () => {
        setError("");
        setStatus("");
        setOauthLoading(true);

        try {
            if (!authCode.trim()) {
                throw new Error("Auth code is required.");
            }

            const response = await fetch("/api/oauth/exchange", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    appKey: form.appKey,
                    appSecret: form.appSecret,
                    authCode: authCode.trim(),
                    baseUrl: form.baseUrl,
                    tokenPath: form.tokenPath,
                }),
            });

            const json = await response.json();
            if (!response.ok) {
                throw new Error(
                    toErrorMessage(
                        json,
                        "Failed to exchange auth code for token.",
                    ),
                );
            }

            if (json.accessToken) {
                setForm((previous) => ({
                    ...previous,
                    accessToken: json.accessToken,
                }));
            }

            if (json.refreshToken) {
                setRefreshToken(json.refreshToken);
            }

            setStatus(
                `Access token updated (${json.mode || "oauth"}). Expires in ${
                    json.accessTokenExpiresIn ?? "unknown"
                } seconds.`,
            );
        } catch (caught) {
            setError(caught.message || "Unable to exchange auth code.");
        } finally {
            setOauthLoading(false);
        }
    };

    const refreshAccessToken = async () => {
        setError("");
        setStatus("");
        setOauthLoading(true);

        try {
            if (!refreshToken.trim()) {
                throw new Error("Refresh token is required.");
            }

            const response = await fetch("/api/oauth/refresh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    appKey: form.appKey,
                    appSecret: form.appSecret,
                    refreshToken: refreshToken.trim(),
                    baseUrl: form.baseUrl,
                    refreshPath: form.refreshPath,
                }),
            });

            const json = await response.json();
            if (!response.ok) {
                throw new Error(
                    toErrorMessage(json, "Failed to refresh access token."),
                );
            }

            if (json.accessToken) {
                setForm((previous) => ({
                    ...previous,
                    accessToken: json.accessToken,
                }));
            }

            if (json.refreshToken) {
                setRefreshToken(json.refreshToken);
            }

            setStatus(
                `Access token refreshed (${json.mode || "oauth"}). Expires in ${
                    json.accessTokenExpiresIn ?? "unknown"
                } seconds.`,
            );
        } catch (caught) {
            setError(caught.message || "Unable to refresh access token.");
        } finally {
            setOauthLoading(false);
        }
    };

    const copyAll = async () => {
        if (!rows.length || !columns.length) return;

        const header = columns.join("\t");
        const body = rows
            .map((row) => columns.map((key) => toTsvValue(row[key])).join("\t"))
            .join("\n");
        const payload = `${header}\n${body}`;

        try {
            await navigator.clipboard.writeText(payload);
            setStatus(`Copied ${rows.length} rows for Google Sheets / Excel.`);
        } catch {
            setError(
                "Clipboard access failed. Allow clipboard permission and retry.",
            );
        }
    };

    return (
        <main className='mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-8 sm:py-10'>
            <section className='rounded-3xl border border-amber-200/70 bg-white/85 p-6 shadow-[0_16px_50px_rgba(217,119,6,0.16)] backdrop-blur md:p-8'>
                <div className='mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
                    <div>
                        <h1 className='text-3xl font-bold tracking-tight text-amber-950 sm:text-4xl'>
                            TikTok Product Exporter
                        </h1>
                        <p className='mt-2 text-amber-900/80'>
                            Pull all allowed product fields, including price and
                            origin price, then copy in one click.
                        </p>
                    </div>
                    <div className='rounded-full border border-amber-300 bg-amber-100/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-amber-900'>
                        Official API via backend proxy
                    </div>
                </div>

                <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
                    <label className='text-sm font-semibold text-amber-900'>
                        Auth URL
                        <input
                            value={form.authUrl}
                            onChange={setField("authUrl")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Redirect URI
                        <input
                            value={form.redirectUri}
                            onChange={setField("redirectUri")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        App Key Query Param
                        <input
                            value={form.appKeyParam}
                            onChange={setField("appKeyParam")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        OAuth Scope (optional)
                        <input
                            value={form.oauthScope}
                            onChange={setField("oauthScope")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        App Key
                        <input
                            value={form.appKey}
                            onChange={setField("appKey")}
                            className='mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        App Secret
                        <input
                            type='password'
                            value={form.appSecret}
                            onChange={setField("appSecret")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Access Token
                        <input
                            value={form.accessToken}
                            onChange={setField("accessToken")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Auth Code
                        <input
                            value={authCode}
                            onChange={(event) =>
                                setAuthCode(event.target.value)
                            }
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Refresh Token
                        <input
                            value={refreshToken}
                            onChange={(event) =>
                                setRefreshToken(event.target.value)
                            }
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Token Path
                        <input
                            value={form.tokenPath}
                            onChange={setField("tokenPath")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Refresh Path
                        <input
                            value={form.refreshPath}
                            onChange={setField("refreshPath")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Shop Cipher (optional)
                        <input
                            value={form.shopCipher}
                            onChange={setField("shopCipher")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Base URL
                        <input
                            value={form.baseUrl}
                            onChange={setField("baseUrl")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Products Path
                        <input
                            value={form.productsPath}
                            onChange={setField("productsPath")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Page Size
                        <input
                            type='number'
                            min={1}
                            max={100}
                            value={form.pageSize}
                            onChange={setField("pageSize")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Max Pages
                        <input
                            type='number'
                            min={1}
                            max={500}
                            value={form.maxPages}
                            onChange={setField("maxPages")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Sign Mode
                        <select
                            value={form.signMode}
                            onChange={setField("signMode")}
                            className='mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-sm outline-none ring-0 focus:border-amber-500'
                        >
                            <option value='dual'>dual (auto)</option>
                            <option value='v1'>v1</option>
                            <option value='v2'>v2</option>
                        </select>
                    </label>
                </div>

                <div className='mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2'>
                    <label className='text-sm font-semibold text-amber-900'>
                        OAuth Extra Query JSON
                        <textarea
                            rows={5}
                            value={form.oauthExtraQuery}
                            onChange={setField("oauthExtraQuery")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-xs outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Extra Query JSON
                        <textarea
                            rows={5}
                            value={form.extraQuery}
                            onChange={setField("extraQuery")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-xs outline-none ring-0 focus:border-amber-500'
                        />
                    </label>

                    <label className='text-sm font-semibold text-amber-900'>
                        Request Body JSON
                        <textarea
                            rows={5}
                            value={form.requestBody}
                            onChange={setField("requestBody")}
                            className='mono mt-1 w-full rounded-xl border border-amber-200 bg-amber-50/45 px-3 py-2 text-xs outline-none ring-0 focus:border-amber-500'
                        />
                    </label>
                </div>

                <div className='mt-5 flex flex-wrap items-center gap-3'>
                    <button
                        onClick={startOauth}
                        disabled={loading || oauthLoading}
                        className='rounded-xl border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45'
                    >
                        {oauthLoading ? "Working..." : "1) Start OAuth"}
                    </button>

                    <button
                        onClick={exchangeAuthCode}
                        disabled={loading || oauthLoading}
                        className='rounded-xl border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45'
                    >
                        {oauthLoading ? "Working..." : "2) Exchange Code"}
                    </button>

                    <button
                        onClick={refreshAccessToken}
                        disabled={loading || oauthLoading}
                        className='rounded-xl border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45'
                    >
                        {oauthLoading ? "Working..." : "3) Refresh Token"}
                    </button>

                    <button
                        onClick={fetchProducts}
                        disabled={loading || oauthLoading}
                        className='rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-amber-300'
                    >
                        {loading ? "Fetching..." : "Fetch Products"}
                    </button>

                    <button
                        onClick={copyAll}
                        disabled={!rows.length}
                        className='rounded-xl border border-amber-300 bg-white px-5 py-2.5 text-sm font-semibold text-amber-900 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-45'
                    >
                        Copy All (Sheets / Excel)
                    </button>

                    <span className='mono text-xs text-amber-800'>
                        {rows.length} row(s) | {columns.length} field(s)
                    </span>
                </div>

                {status && (
                    <p className='mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800'>
                        {status}
                    </p>
                )}

                {error && (
                    <p className='mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700'>
                        {error}
                    </p>
                )}
            </section>

            <section className='data-grid-wrap mt-6 rounded-3xl border border-amber-200/70 bg-white/85 p-4 shadow-[0_10px_35px_rgba(217,119,6,0.14)] backdrop-blur md:p-6'>
                <h2 className='mb-3 text-lg font-bold text-amber-950'>
                    Product Data
                </h2>
                <div className='overflow-auto rounded-xl'>
                    <DataGrid
                        columns={gridColumns}
                        rows={rows}
                        className='fill-grid min-h-[440px]'
                        rowHeight={38}
                        headerRowHeight={44}
                    />
                </div>
            </section>
        </main>
    );
}

export default App;
