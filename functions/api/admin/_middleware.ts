/// <reference types="@cloudflare/workers-types" />

export const onRequest: PagesFunction = async ({ next }) => {
  const response = await next();
  const responseWithCacheControl = new Response(response.body, response);
  responseWithCacheControl.headers.set("Cache-Control", "no-store");
  return responseWithCacheControl;
};
