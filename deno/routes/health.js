import { Router } from "oak";
import { checkDatabaseHealth } from "../db/supabase.js";

const router = new Router();

// Basic health check
router.get("/health", (ctx) => {
  ctx.response.body = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    environment: Deno.env.get("DENO_ENV") || "development"
  };
});

// Database health check
router.get("/health/db", async (ctx) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    ctx.response.body = {
      status: "healthy",
      database: dbHealth,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      status: "unhealthy",
      database: { error: error.message },
      timestamp: new Date().toISOString()
    };
  }
});

// Auth service health check
router.get("/health/auth", (ctx) => {
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const jwtSecret = Deno.env.get("JWT_SECRET");
  
  ctx.response.body = {
    status: googleClientId && jwtSecret ? "healthy" : "unhealthy",
    auth: {
      googleClientId: googleClientId ? "configured" : "missing",
      jwtSecret: jwtSecret ? "configured" : "missing"
    },
    timestamp: new Date().toISOString()
  };
});

// Calendar service health check
router.get("/health/calendar", (ctx) => {
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  
  ctx.response.body = {
    status: googleClientId && googleClientSecret ? "healthy" : "unhealthy",
    calendar: {
      googleClientId: googleClientId ? "configured" : "missing",
      googleClientSecret: googleClientSecret ? "configured" : "missing"
    },
    timestamp: new Date().toISOString()
  };
});

// Comprehensive health check
router.get("/health/all", async (ctx) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const jwtSecret = Deno.env.get("JWT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    const allHealthy = dbHealth.status === "healthy" && 
                      googleClientId && 
                      googleClientSecret && 
                      jwtSecret && 
                      supabaseUrl && 
                      supabaseKey;
    
    ctx.response.body = {
      status: allHealthy ? "healthy" : "unhealthy",
      services: {
        database: dbHealth,
        auth: {
          googleClientId: googleClientId ? "configured" : "missing",
          jwtSecret: jwtSecret ? "configured" : "missing"
        },
        calendar: {
          googleClientId: googleClientId ? "configured" : "missing",
          googleClientSecret: googleClientSecret ? "configured" : "missing"
        },
        supabase: {
          url: supabaseUrl ? "configured" : "missing",
          key: supabaseKey ? "configured" : "missing"
        }
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = {
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
});

export { router as healthRouter };
