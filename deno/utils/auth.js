import { create, verify } from "djwt";
import { supabase } from "../db/supabase.js";

const JWT_SECRET = Deno.env.get("JWT_SECRET") || "your-secret-key";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");

// Generate JWT token
export async function generateJWT(user) {
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
  };
  
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  return await create({ alg: "HS256", typ: "JWT" }, payload, key);
}

// Validate JWT token
export async function validateJWT(token) {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    
    const payload = await verify(token, key);
    
    // Get user from database
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", payload.sub)
      .single();
    
    if (error || !user) {
      throw new Error("User not found");
    }
    
    return user;
  } catch (error) {
    throw new Error("Invalid token");
  }
}

// Get or create user
export async function getOrCreateUser(userInfo) {
  try {
    // Check if user exists
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("*")
      .eq("email", userInfo.email)
      .single();
    
    if (existingUser) {
      return existingUser;
    }
    
    // Create new user
    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        email: userInfo.email,
        name: userInfo.name,
        google_id: userInfo.sub,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (insertError) throw insertError;
    
    return newUser;
  } catch (error) {
    throw new Error(`Failed to get or create user: ${error.message}`);
  }
}

// Validate Google token
export async function validateGoogleToken(code) {
  try {
    // Exchange authorization code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${Deno.env.get("BACKEND_URL") || "http://localhost:8000"}/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    
    if (!tokenResponse.ok) {
      throw new Error("Failed to exchange code for tokens");
    }
    
    const tokens = await tokenResponse.json();
    
    // Get user info from Google
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });
    
    if (!userResponse.ok) {
      throw new Error("Failed to get user info from Google");
    }
    
    const userInfo = await userResponse.json();
    
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      userInfo
    };
  } catch (error) {
    throw new Error(`Google token validation failed: ${error.message}`);
  }
}
