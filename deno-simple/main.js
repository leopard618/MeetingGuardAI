import { Application, Router } from "https://deno.land/x/oak@v12.6.1/mod.ts";

const app = new Application();
const router = new Router();

// Health check endpoint
router.get("/health", (ctx) => {
  ctx.response.body = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    message: "MeetingGuard AI Backend is running!"
  };
});

// API routes
app.use(router.routes());
app.use(router.allowedMethods());

// 404 handler
app.use((ctx) => {
  ctx.response.status = 404;
  ctx.response.body = {
    error: "Not found",
    path: ctx.request.url.pathname,
    timestamp: new Date().toISOString()
  };
});

const port = parseInt(Deno.env.get("PORT") || "8000");

console.log(`🚀 MeetingGuard AI Backend starting on port ${port}`);
console.log(`📊 Health check: http://localhost:${port}/health`);

await app.listen({ port });
