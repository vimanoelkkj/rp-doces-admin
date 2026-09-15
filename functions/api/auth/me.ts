/// <reference types="@cloudflare/workers-types" />

import { currentUser } from "../../lib/auth";

interface Env {
  DB: D1Database;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await currentUser(env.DB, request);
  if (!user) {
    return Response.json({ authenticated: false }, { status: 401 });
  }
  return Response.json({ authenticated: true, usuario: user });
};
