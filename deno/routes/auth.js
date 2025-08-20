import { Router } from "oak";
import { generateJWT, validateJWT, getOrCreateUser, validateGoogleToken } from "../utils/auth.js";

const router = new Router();

// Google OAuth callback
router.get("/auth/google/callback", async (ctx) => {
  try {
    const code = ctx.request.url.searchParams.get("code");
    const state = ctx.request.url.searchParams.get("state");
    
    if (!code) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Authorization code required" };
      return;
    }
    
    // Exchange code for tokens
    const tokens = await validateGoogleToken(code);
    
    // Get or create user
    const user = await getOrCreateUser(tokens.userInfo);
    
    // Generate JWT
    const jwt = await generateJWT(user);
    
    // Redirect to frontend with token
    const redirectUrl = `${Deno.env.get("FRONTEND_URL") || "http://localhost:3000"}/auth/callback?token=${jwt}`;
    ctx.response.redirect(redirectUrl);
    
  } catch (error) {
    console.error("Auth callback error:", error);
    ctx.response.status = 500;
    ctx.response.body = { error: "Authentication failed" };
  }
});

// Validate JWT token
router.post("/auth/validate", async (ctx) => {
  try {
    const { token } = await ctx.request.body().value;
    
    if (!token) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Token required" };
      return;
    }
    
    const user = await validateJWT(token);
    ctx.response.body = { 
      valid: true, 
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    };
    
  } catch (error) {
    ctx.response.status = 401;
    ctx.response.body = { valid: false, error: error.message };
  }
});

// Refresh JWT token
router.post("/auth/refresh", async (ctx) => {
  try {
    const { token } = await ctx.request.body().value;
    
    if (!token) {
      ctx.response.status = 400;
      ctx.response.body = { error: "Token required" };
      return;
    }
    
    const user = await validateJWT(token);
    const newToken = await generateJWT(user);
    
    ctx.response.body = { 
      token: newToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      }
    };
    
  } catch (error) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Invalid token" };
  }
});

// Logout
router.post("/auth/logout", (ctx) => {
  // In a stateless JWT system, logout is handled client-side
  // by removing the token from storage
  ctx.response.body = { message: "Logged out successfully" };
});

export { router as authRouter };
