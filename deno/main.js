import { Application, Router } from "oak";
import { config } from "dotenv";

// Import route handlers
import { meetingsRouter } from "./routes/meetings.js";
import { authRouter } from "./routes/auth.js";
import { calendarRouter } from "./routes/calendar.js";
import { healthRouter } from "./routes/health.js";

// Load environment variables (optional for development)
let env = {};
try {
  env = config();
} catch (error) {
  console.log('No .env file found, using defaults');
}

const app = new Application();
const router = new Router();

// CORS configuration - temporarily disabled for development
// app.use(cors({
//   origin: env.CORS_ORIGIN || "*",
//   credentials: true,
// }));

// Error handling middleware (must come first)
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error("Server error:", err);
    ctx.response.status = err.status || 500;
    ctx.response.body = {
      error: err.message || "Internal server error",
      timestamp: new Date().toISOString()
    };
  }
});

// Request logging middleware
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${ctx.request.method} ${ctx.request.url.pathname} - ${ms}ms`);
});

// Health check endpoint
router.get("/health", (ctx) => {
  ctx.response.body = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    environment: Deno.env.get("DENO_ENV") || "development"
  };
});

// API routes
app.use(router.routes());
app.use(router.allowedMethods());
app.use(meetingsRouter.routes());
app.use(meetingsRouter.allowedMethods());
app.use(authRouter.routes());
app.use(authRouter.allowedMethods());
app.use(calendarRouter.routes());
app.use(calendarRouter.allowedMethods());
app.use(healthRouter.routes());
app.use(healthRouter.allowedMethods());

// 404 handler (must come last)
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
console.log(`🌍 Environment: ${Deno.env.get("DENO_ENV") || "development"}`);

await app.listen({ port });
