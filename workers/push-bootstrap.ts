// Provision secrets on an inert Worker before attaching any consumer or cron.
export default {
  fetch(): Response {
    return new Response("Push worker bootstrap only", { status: 503 });
  }
} satisfies ExportedHandler;
