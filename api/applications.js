const GOOGLE_FORM_ACTION =
  "https://docs.google.com/forms/d/e/1FAIpQLSeEbZF4OGgvIcs7y0LYIOXX_C2pOBek3qHX-275Y5OHuJwXcg/formResponse";

export const REQUIRED_FIELDS = [
  "entry.413857955",
  "entry.1004975095",
  "entry.675889242",
  "entry.700438953",
  "entry.683960552",
  "entry.1789254280",
  "entry.541657209",
  "entry.1596782367",
  "entry.544202838",
  "entry.401901514",
  "entry.11591920",
  "entry.763598235",
  "entry.1637579228",
  "entry.1820302390",
  "entry.1223268514",
  "entry.307628546",
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
    Vary: "Origin",
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

      if (params.get("entry.1789254280") !== "Sim") {
        return json(
          origin,
          { ok: false, message: "O perfil do Instagram precisa estar público durante a seleção." },
          422,
        );
      }

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

      return json(origin, { ok: true, message: "Candidatura recebida com sucesso." }, 201);
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
