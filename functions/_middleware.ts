/// <reference types="@cloudflare/workers-types" />

import {
  getRequestContext,
  logRequestEvent,
  requestLogger,
  withRequestContext
} from "./lib/requestContext";

// Root Pages middleware covers every Functions route, including nested admin
// middleware. Incoming headers remain untouched (notably webhook signatures).
export const onRequest: PagesFunction = context =>
  withRequestContext(context.request, async () => {
    const requestContext = getRequestContext();
    if (!requestContext) throw new Error("Request context unavailable");
    const requestId = requestContext.requestId;
    context.data.requestId = requestId;
    try {
      const response = await context.next();
      const correlated = new Response(response.body, response);
      correlated.headers.set("X-Request-Id", requestId);
      logRequestEvent("HTTP_REQUEST_COMPLETED", response.status);
      return correlated;
    } catch (error) {
      requestLogger.error("UNEXPECTED_REQUEST_ERROR", error);
      throw error;
    }
  });
