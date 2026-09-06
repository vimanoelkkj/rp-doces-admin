import { z } from "zod";

export const sqliteBoolean = z
  .union([z.literal(0), z.literal(1), z.boolean()])
  .transform(value => value === 1 || value === true);
