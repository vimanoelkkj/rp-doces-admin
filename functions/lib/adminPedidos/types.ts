/// <reference types="@cloudflare/workers-types" />
import type { PushQueueMessage } from "../pushOutbox";

export interface Env {
  DB: D1Database;
  PUSH_QUEUE?: Queue<PushQueueMessage>;
  MP_ACCESS_TOKEN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}
