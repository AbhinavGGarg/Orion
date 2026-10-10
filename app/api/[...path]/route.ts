export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCAL_BACKEND_URL = "http://localhost:8000";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

function normalizeBackendUrl(value: string): string {
  return value.replace(/\/+$/, "").replace(/\/api$/, "");
}

function resolveBackendBaseUrl(): string {
  const configured =
    process.env.BACKEND_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim();

  if (configured) {
    return normalizeBackendUrl(configured);
  }

  if (process.env.NODE_ENV !== "production") {
    return LOCAL_BACKEND_URL;
  }

  return "";
}

async function proxyRequest(request: Request, context: RouteContext): Promise<Response> {
  const backendBase = resolveBackendBaseUrl();
  if (!backendBase) {
    return Response.json(
      {
        detail:
          "Backend API is not configured. Set BACKEND_API_URL in your deployment environment.",
      },
      { status: 503 },
    );
  }

  const { path } = await context.params;
  const incomingUrl = new URL(request.url);
  const pathSuffix = path.length > 0 ? `/${path.join("/")}` : "";
  const upstreamUrl = `${backendBase}/api${pathSuffix}${incomingUrl.search}`;

  try {
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");

    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: "manual",
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      const body = await request.arrayBuffer();
      if (body.byteLength > 0) {
        init.body = body;
      }
    }

    const upstreamResponse = await fetch(upstreamUrl, init);
    const responseHeaders = new Headers(upstreamResponse.headers);
    responseHeaders.delete("content-length");

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      {
        detail: `Failed to reach backend API at ${backendBase}.`,
      },
      { status: 502 },
    );
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return proxyRequest(request, context);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return proxyRequest(request, context);
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  return proxyRequest(request, context);
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return proxyRequest(request, context);
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return proxyRequest(request, context);
}

export async function OPTIONS(request: Request, context: RouteContext): Promise<Response> {
  return proxyRequest(request, context);
}
