import cors from "cors";
import crypto from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import axios from "axios";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8787);
const defaultBaseUrl =
    process.env.TIKTOK_BASE_URL || "https://open-api.tiktokglobalshop.com";
const defaultProductsPath =
    process.env.TIKTOK_PRODUCTS_PATH || "/product/202309/products/search";
const defaultAuthUrl =
    process.env.TIKTOK_AUTH_URL ||
    "https://services.tiktokshop.com/open/authorize";
const defaultTokenPath =
    process.env.TIKTOK_TOKEN_PATH || "/authorization/202309/token/get";
const defaultRefreshPath =
    process.env.TIKTOK_REFRESH_PATH || "/authorization/202309/token/refresh";

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getByPath(obj, path) {
    return path
        .split(".")
        .reduce(
            (acc, segment) => (acc == null ? undefined : acc[segment]),
            obj,
        );
}

function firstDefinedValue(obj, paths) {
    for (const path of paths) {
        const value = getByPath(obj, path);
        if (value !== undefined && value !== null && value !== "") {
            return value;
        }
    }
    return undefined;
}

function extractProducts(payload) {
    const listCandidates = [
        "data.products",
        "data.product_list",
        "data.items",
        "data.list",
        "products",
        "product_list",
        "items",
        "list",
    ];

    for (const path of listCandidates) {
        const value = getByPath(payload, path);
        if (Array.isArray(value)) {
            return value;
        }
    }

    return [];
}

function extractNextToken(payload) {
    const tokenCandidates = [
        "data.next_page_token",
        "data.page_info.next_page_token",
        "data.page_token",
        "data.next_cursor",
        "next_page_token",
        "next_cursor",
    ];

    for (const path of tokenCandidates) {
        const value = getByPath(payload, path);
        if (value !== undefined && value !== null && value !== "") {
            return String(value);
        }
    }

    return "";
}

function extractHasMore(payload) {
    const candidates = [
        "data.has_next_page",
        "data.more",
        "data.has_more",
        "has_next_page",
        "has_more",
    ];

    for (const path of candidates) {
        const value = getByPath(payload, path);
        if (typeof value === "boolean") {
            return value;
        }
        if (value === 0 || value === 1) {
            return Boolean(value);
        }
    }

    return false;
}

function normalizeProduct(product) {
    if (!isObject(product)) return product;

    const mappedPrice = firstDefinedValue(product, [
        "price",
        "sale_price",
        "price_info.sale_price",
        "price_info.price",
        "skus.0.sale_price",
        "skus.0.price",
    ]);

    const mappedOriginPrice = firstDefinedValue(product, [
        "origin_price",
        "original_price",
        "price_info.origin_price",
        "price_info.original_price",
        "skus.0.origin_price",
        "skus.0.original_price",
    ]);

    return {
        ...product,
        price: product.price ?? mappedPrice ?? "",
        origin_price:
            product.origin_price ??
            product.original_price ??
            mappedOriginPrice ??
            "",
    };
}

function extractTokenBundle(payload) {
    const accessToken = firstDefinedValue(payload, [
        "data.access_token",
        "data.accessToken",
        "access_token",
        "accessToken",
    ]);
    const refreshToken = firstDefinedValue(payload, [
        "data.refresh_token",
        "data.refreshToken",
        "refresh_token",
        "refreshToken",
    ]);
    const accessTokenExpiresIn = firstDefinedValue(payload, [
        "data.access_token_expire_in",
        "data.access_token_expires_in",
        "data.access_token_expired_in",
        "access_token_expire_in",
        "access_token_expires_in",
    ]);
    const refreshTokenExpiresIn = firstDefinedValue(payload, [
        "data.refresh_token_expire_in",
        "data.refresh_token_expires_in",
        "data.refresh_token_expired_in",
        "refresh_token_expire_in",
        "refresh_token_expires_in",
    ]);
    const openId = firstDefinedValue(payload, [
        "data.open_id",
        "data.openId",
        "open_id",
        "openId",
    ]);
    const sellerName = firstDefinedValue(payload, [
        "data.seller_name",
        "data.sellerName",
        "seller_name",
        "sellerName",
    ]);

    return {
        accessToken: accessToken ? String(accessToken) : "",
        refreshToken: refreshToken ? String(refreshToken) : "",
        accessTokenExpiresIn: accessTokenExpiresIn
            ? Number(accessTokenExpiresIn)
            : null,
        refreshTokenExpiresIn: refreshTokenExpiresIn
            ? Number(refreshTokenExpiresIn)
            : null,
        openId: openId ? String(openId) : "",
        sellerName: sellerName ? String(sellerName) : "",
    };
}

function isTikTokApiSuccess(payload) {
    const code = firstDefinedValue(payload, ["code", "status_code", "errno"]);
    if (code === undefined || code === null || code === "") return true;

    const numeric = Number(code);
    if (!Number.isNaN(numeric)) {
        return numeric === 0;
    }

    return String(code) === "0";
}

function createApiError(message, detail) {
    const error = new Error(message);
    error.detail = detail;
    return error;
}

async function requestOauthToken({
    appKey,
    appSecret,
    baseUrl,
    path,
    bodyCandidates,
}) {
    let lastError = null;

    for (const body of bodyCandidates) {
        const bodyString = JSON.stringify(body);
        const timestamp = Math.floor(Date.now() / 1000);
        const signQueryBase = {
            app_key: appKey,
            timestamp,
        };

        const attempts = [
            {
                name: "unsigned",
                params: {},
                data: body,
                headers: {
                    "content-type": "application/json",
                },
            },
            {
                name: "signed-v1",
                params: {
                    ...signQueryBase,
                    sign: signV1({
                        appSecret,
                        path,
                        query: signQueryBase,
                        bodyString,
                    }),
                },
                data: body,
                headers: {
                    "content-type": "application/json",
                },
            },
            {
                name: "signed-v2",
                params: {
                    ...signQueryBase,
                    sign: signV2({
                        appSecret,
                        path,
                        query: signQueryBase,
                        bodyString,
                    }),
                },
                data: body,
                headers: {
                    "content-type": "application/json",
                },
            },
        ];

        for (const attempt of attempts) {
            try {
                const response = await axios.post(
                    `${baseUrl}${path}`,
                    attempt.data,
                    {
                        params: attempt.params,
                        headers: attempt.headers,
                        timeout: 45000,
                    },
                );

                const tokenBundle = extractTokenBundle(response.data);

                if (!isTikTokApiSuccess(response.data)) {
                    lastError = createApiError(
                        "TikTok token endpoint returned a non-success code.",
                        response.data,
                    );
                    continue;
                }

                if (!tokenBundle.accessToken) {
                    lastError = createApiError(
                        "Token response did not include an access token.",
                        response.data,
                    );
                    continue;
                }

                return {
                    ...tokenBundle,
                    raw: response.data,
                    mode: attempt.name,
                };
            } catch (error) {
                lastError = error;
            }
        }
    }

    throw lastError || createApiError("Failed to retrieve OAuth token.");
}

function canonicalQuery(query) {
    return Object.keys(query)
        .filter(
            (key) =>
                query[key] !== undefined &&
                query[key] !== null &&
                query[key] !== "",
        )
        .sort()
        .map((key) => `${key}${query[key]}`)
        .join("");
}

function signV1({ appSecret, path, query, bodyString }) {
    const base = `${appSecret}${path}${canonicalQuery(query)}${bodyString}${appSecret}`;
    return crypto.createHmac("sha256", appSecret).update(base).digest("hex");
}

function signV2({ appSecret, path, query, bodyString }) {
    const base = `${path}${canonicalQuery(query)}${bodyString}`;
    return crypto.createHmac("sha256", appSecret).update(base).digest("hex");
}

async function requestProductsPage({
    appKey,
    appSecret,
    accessToken,
    shopCipher,
    baseUrl,
    productsPath,
    requestBody,
    extraQuery,
    signMode,
}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const baseQuery = {
        app_key: appKey,
        timestamp,
        access_token: accessToken,
        ...extraQuery,
    };

    if (shopCipher) {
        baseQuery.shop_cipher = shopCipher;
    }

    const bodyString = JSON.stringify(requestBody);

    const variants =
        signMode === "v1" ? ["v1"] : signMode === "v2" ? ["v2"] : ["v1", "v2"];

    let lastError = null;

    for (const variant of variants) {
        const sign =
            variant === "v1"
                ? signV1({
                      appSecret,
                      path: productsPath,
                      query: baseQuery,
                      bodyString,
                  })
                : signV2({
                      appSecret,
                      path: productsPath,
                      query: baseQuery,
                      bodyString,
                  });

        try {
            const response = await axios.post(
                `${baseUrl}${productsPath}`,
                requestBody,
                {
                    params: {
                        ...baseQuery,
                        sign,
                    },
                    headers: {
                        "content-type": "application/json",
                        "x-tts-access-token": accessToken,
                    },
                    timeout: 45000,
                },
            );

            return { data: response.data, signVariant: variant };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError;
}

app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
});

app.post("/api/oauth/authorize-url", async (req, res) => {
    const {
        appKey,
        redirectUri,
        authUrl = defaultAuthUrl,
        appKeyParam = "app_key",
        scope = "",
        state = crypto.randomUUID(),
        extraQuery = {},
    } = req.body || {};

    if (!appKey || !redirectUri || !authUrl) {
        return res.status(400).json({
            error: "appKey, redirectUri, and authUrl are required.",
        });
    }

    try {
        const url = new URL(authUrl);
        url.searchParams.set(appKeyParam, String(appKey));
        url.searchParams.set("redirect_uri", String(redirectUri));
        url.searchParams.set("state", String(state));

        if (scope) {
            url.searchParams.set("scope", String(scope));
        }

        if (isObject(extraQuery)) {
            for (const [key, value] of Object.entries(extraQuery)) {
                if (value !== undefined && value !== null && value !== "") {
                    url.searchParams.set(key, String(value));
                }
            }
        }

        return res.json({
            url: url.toString(),
            state,
        });
    } catch {
        return res.status(400).json({
            error: "authUrl must be a valid absolute URL.",
        });
    }
});

app.post("/api/oauth/exchange", async (req, res) => {
    const {
        appKey,
        appSecret,
        authCode,
        baseUrl = defaultBaseUrl,
        tokenPath = defaultTokenPath,
    } = req.body || {};

    if (!appKey || !appSecret || !authCode) {
        return res.status(400).json({
            error: "appKey, appSecret, and authCode are required.",
        });
    }

    if (!tokenPath.startsWith("/")) {
        return res.status(400).json({
            error: "tokenPath must start with /.",
        });
    }

    const bodyCandidates = [
        {
            app_key: appKey,
            app_secret: appSecret,
            auth_code: authCode,
            grant_type: "authorized_code",
        },
        {
            app_key: appKey,
            app_secret: appSecret,
            auth_code: authCode,
            grant_type: "authorization_code",
        },
        {
            app_key: appKey,
            app_secret: appSecret,
            code: authCode,
            grant_type: "authorization_code",
        },
        {
            app_key: appKey,
            app_secret: appSecret,
            auth_code: authCode,
        },
    ];

    try {
        const result = await requestOauthToken({
            appKey,
            appSecret,
            baseUrl,
            path: tokenPath,
            bodyCandidates,
        });

        return res.json(result);
    } catch (error) {
        return res.status(error.response?.status || 500).json({
            error: "Failed to exchange auth code for access token.",
            detail: error.detail || error.response?.data || error.message,
        });
    }
});

app.post("/api/oauth/refresh", async (req, res) => {
    const {
        appKey,
        appSecret,
        refreshToken,
        baseUrl = defaultBaseUrl,
        refreshPath = defaultRefreshPath,
    } = req.body || {};

    if (!appKey || !appSecret || !refreshToken) {
        return res.status(400).json({
            error: "appKey, appSecret, and refreshToken are required.",
        });
    }

    if (!refreshPath.startsWith("/")) {
        return res.status(400).json({
            error: "refreshPath must start with /.",
        });
    }

    const bodyCandidates = [
        {
            app_key: appKey,
            app_secret: appSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
        },
        {
            app_key: appKey,
            app_secret: appSecret,
            refresh_token: refreshToken,
        },
    ];

    try {
        const result = await requestOauthToken({
            appKey,
            appSecret,
            baseUrl,
            path: refreshPath,
            bodyCandidates,
        });

        return res.json(result);
    } catch (error) {
        return res.status(error.response?.status || 500).json({
            error: "Failed to refresh access token.",
            detail: error.detail || error.response?.data || error.message,
        });
    }
});

app.post("/api/products/fetch", async (req, res) => {
    const {
        appKey,
        appSecret,
        accessToken,
        shopCipher = "",
        baseUrl = defaultBaseUrl,
        productsPath = defaultProductsPath,
        pageSize = 100,
        maxPages = 20,
        signMode = "dual",
        extraQuery = {},
        requestBody = {},
    } = req.body || {};

    if (!appKey || !appSecret || !accessToken) {
        return res.status(400).json({
            error: "appKey, appSecret, and accessToken are required.",
        });
    }

    if (!productsPath.startsWith("/")) {
        return res.status(400).json({
            error: "productsPath must start with /.",
        });
    }

    const safePageSize = Math.max(1, Math.min(Number(pageSize) || 100, 100));
    const safeMaxPages = Math.max(1, Math.min(Number(maxPages) || 20, 500));

    const allProducts = [];
    let cursor = "";
    let pagesFetched = 0;
    let signVariant = "unknown";

    try {
        for (let page = 0; page < safeMaxPages; page += 1) {
            const payload = {
                ...requestBody,
            };

            if (payload.page_size === undefined) {
                payload.page_size = safePageSize;
            }

            if (cursor) {
                payload.page_token = cursor;
            }

            const result = await requestProductsPage({
                appKey,
                appSecret,
                accessToken,
                shopCipher,
                baseUrl,
                productsPath,
                requestBody: payload,
                extraQuery,
                signMode,
            });

            signVariant = result.signVariant;
            pagesFetched += 1;

            const products = extractProducts(result.data);
            allProducts.push(...products.map((item) => normalizeProduct(item)));

            const nextCursor = extractNextToken(result.data);
            const hasMore = extractHasMore(result.data);

            if (!nextCursor || nextCursor === cursor) {
                break;
            }

            if (!hasMore && products.length < safePageSize) {
                break;
            }

            cursor = nextCursor;
        }

        return res.json({
            products: allProducts,
            totalProducts: allProducts.length,
            pagesFetched,
            signModeUsed: signVariant,
        });
    } catch (error) {
        const apiMessage = error.response?.data || error.message;
        return res.status(error.response?.status || 500).json({
            error: "TikTok API request failed.",
            detail: apiMessage,
        });
    }
});

app.listen(port, "0.0.0.0", () => {
    console.log(`TikTok proxy listening on http://0.0.0.0:${port}`);
});
