const GOOGLE_FORM_ACTION =
  "https://docs.google.com/forms/d/e/1FAIpQLSeEbZF4OGgvIcs7y0LYIOXX_C2pOBek3qHX-275Y5OHuJwXcg/formResponse";
const TIKTOK_EVENTS_API_URL =
  "https://business-api.tiktok.com/open_api/v1.3/event/track/";
const DEFAULT_TIKTOK_PIXEL_ID = "DA92IPRC77U3MKV9RUSG";
const TIKTOK_TRACKING_FIELDS = [
  "tiktok_event_id",
  "tiktok_ttclid",
  "tiktok_ttp",
  "tiktok_diagnostic",
];

export const REQUIRED_FIELDS = [
  "entry.413857955",
  "entry.1004975095",
  "entry.675889242",
  "entry.700438953",
  "entry.683960552",
  "entry.1596782367",
  "entry.544202838",
  "entry.401901514",
  "entry.11591920",
  "entry.763598235",
  "entry.1637579228",
  "entry.1820302390",
  "entry.1223268514",
  "entry.474698771",
  "entry.317041343",
];

const EXACT_ORIGINS = new Set([
  "https://creators.usevestea.com.br",
  "https://marceloelps.github.io",
  "https://campanha-influencers.vercel.app",
  "http://localhost:3000",
  "http://localhost:4173",
]);

function isAllowedOrigin(origin) {
  if (EXACT_ORIGINS.has(origin)) return true;

  try {
    const { hostname, protocol } = new URL(origin);
    return (
      protocol === "https:" &&
      hostname.startsWith("campanha-influencers-") &&
      hostname.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
}

function responseHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(origin, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin),
  });
}

function hasCompletePayload(params) {
  return REQUIRED_FIELDS.every((field) => params.get(field)?.trim());
}

function cleanTrackingValue(value, maxLength = 512) {
  return String(value || "").trim().slice(0, maxLength);
}

function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return cleanTrackingValue(forwarded.split(",")[0], 64) ||
    cleanTrackingValue(request.headers.get("x-real-ip"), 64);
}

async function sendTikTokApplicationEvent(request, tracking) {
  const accessToken = process.env.TIKTOK_EVENTS_API_ACCESS_TOKEN?.trim();
  if (!accessToken || !tracking.eventId) return { sent: false, reason: "not-configured" };

  const pixelId = process.env.TIKTOK_PIXEL_ID?.trim() || DEFAULT_TIKTOK_PIXEL_ID;
  const user = {
    ip: clientIp(request),
    user_agent: cleanTrackingValue(request.headers.get("user-agent"), 1_000),
    ttclid: tracking.ttclid,
    ttp: tracking.ttp,
  };

  Object.keys(user).forEach((key) => {
    if (!user[key]) delete user[key];
  });

  const payload = {
    event_source: "web",
    event_source_id: pixelId,
    data: [
      {
        event: "Lead",
        event_time: Math.floor(Date.now() / 1_000),
        event_id: tracking.eventId,
        user,
        page: {
          url: "https://creators.usevestea.com.br/candidatura/",
        },
      },
    ],
  };

  const testEventCode = process.env.TIKTOK_TEST_EVENT_CODE?.trim();
  if (testEventCode) payload.test_event_code = testEventCode;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(TIKTOK_EVENTS_API_URL, {
      method: "POST",
      headers: {
        "Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.code !== 0) {
      console.error("TikTok Events API rejeitou o evento.", {
        status: response.status,
        code: result.code,
        requestId: result.request_id,
      });
      return { sent: false, reason: "rejected" };
    }

    return { sent: true };
  } catch (error) {
    console.error("TikTok Events API não confirmou o evento.", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return { sent: false, reason: "network" };
  } finally {
    clearTimeout(timeout);
  }
}

const applicationsApi = {
  async fetch(request) {
    const origin = request.headers.get("origin") || "";

    if (!isAllowedOrigin(origin)) {
      return json("null", { ok: false, message: "Origem não autorizada." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders(origin) });
    }

    if (request.method !== "POST") {
      return json(origin, { ok: false, message: "Método não permitido." }, 405);
    }

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 64_000) {
      return json(origin, { ok: false, message: "Os dados enviados excedem o limite permitido." }, 413);
    }

    try {
      const rawBody = await request.text();
      if (rawBody.length > 64_000) {
        return json(origin, { ok: false, message: "Os dados enviados excedem o limite permitido." }, 413);
      }

      const params = new URLSearchParams(rawBody);
      if (!hasCompletePayload(params)) {
        return json(
          origin,
          { ok: false, message: "Revise os campos obrigatórios antes de enviar." },
          422,
        );
      }

      const followerCount = Number(params.get("entry.683960552"));
      if (!Number.isInteger(followerCount) || followerCount <= 5000) {
        return json(
          origin,
          { ok: false, message: "Esta seleção é destinada a perfis com mais de 5 mil seguidores." },
          422,
        );
      }

      const niche = params.get("entry.675889242");
      const nicheDetail = (params.get("niche_detail") || "").trim().slice(0, 100);
      const tiktokTracking = {
        eventId: cleanTrackingValue(params.get("tiktok_event_id"), 128),
        ttclid: cleanTrackingValue(params.get("tiktok_ttclid")),
        ttp: cleanTrackingValue(params.get("tiktok_ttp")),
      };
      const tiktokDiagnostic = params.get("tiktok_diagnostic") === "1";

      if (niche === "Outro" && !nicheDetail) {
        return json(
          origin,
          { ok: false, message: "Informe qual é o seu nicho antes de enviar." },
          422,
        );
      }

      if (niche === "Outro") {
        const motivation = (params.get("entry.763598235") || "").trim();
        params.set(
          "entry.763598235",
          `Nicho informado: ${nicheDetail}\n\n${motivation}`,
        );
      }

      params.delete("niche_detail");
      params.delete("entry.541657209");
      params.delete("entry.307628546");
      TIKTOK_TRACKING_FIELDS.forEach((field) => params.delete(field));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);
      let googleResponse;

      try {
        googleResponse = await fetch(GOOGLE_FORM_ACTION, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: params.toString(),
          redirect: "follow",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!googleResponse.ok) {
        return json(
          origin,
          { ok: false, message: "O Google Forms não confirmou o recebimento. Tente novamente." },
          502,
        );
      }

      const tiktokResult = await sendTikTokApplicationEvent(request, tiktokTracking);

      return json(
        origin,
        {
          ok: true,
          message: "Candidatura recebida com sucesso.",
          ...(tiktokDiagnostic ? { tiktok: tiktokResult } : {}),
        },
        201,
      );
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      return json(
        origin,
        {
          ok: false,
          message: timedOut
            ? "O serviço de envio demorou para responder. Tente novamente."
            : "Não foi possível confirmar o recebimento. Tente novamente.",
        },
        502,
      );
    }
  },
};

export default applicationsApi;
