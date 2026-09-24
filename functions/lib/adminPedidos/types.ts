/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  MP_ACCESS_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}
