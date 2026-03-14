import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE = "http://120.26.40.125:8084";

async function handleRequest(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await context.params;
    const targetPath = path.join("/");
    const targetUrl = `${BACKEND_BASE}/${targetPath}`;

    const contentType = req.headers.get("content-type") || "";
    let body: BodyInit | undefined = undefined;

    if (req.method !== "GET" && req.method !== "HEAD") {
      if (contentType.includes("application/json")) {
        const json = await req.json();
        body = JSON.stringify(json);
      } else {
        body = await req.text();
      }
    }

    const res = await fetch(targetUrl, {
      method: req.method,
      headers: contentType ? { "Content-Type": contentType } : {},
      body,
      cache: "no-store",
    });

    const text = await res.text();

    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (error) {
    console.error("proxy error:", error);
    return NextResponse.json({ error: "代理请求失败" }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(req, context);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(req, context);
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(req, context);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  return handleRequest(req, context);
}