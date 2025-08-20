import { Router } from "oak";
import { validateJWT } from "../utils/auth.js";
import { supabase } from "../db/supabase.js";

const router = new Router();

// Middleware to validate JWT
async function authMiddleware(ctx, next) {
  try {
    const authHeader = ctx.request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      ctx.response.status = 401;
      ctx.response.body = { error: "Authorization header required" };
      return;
    }
    
    const token = authHeader.substring(7);
    const user = await validateJWT(token);
    ctx.state.user = user;
    await next();
  } catch (error) {
    ctx.response.status = 401;
    ctx.response.body = { error: "Invalid token" };
  }
}

// Get all meetings for user
router.get("/meetings", authMiddleware, async (ctx) => {
  try {
    const { data, error } = await supabase
      .from("meetings")
      .select("*")
      .eq("user_id", ctx.state.user.id)
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    
    ctx.response.body = { meetings: data || [] };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Get single meeting
router.get("/meetings/:id", authMiddleware, async (ctx) => {
  try {
    const { id } = ctx.params;
    const { data, error } = await supabase
      .from("meetings")
      .select("*")
      .eq("id", id)
      .eq("user_id", ctx.state.user.id)
      .single();
    
    if (error) throw error;
    
    if (!data) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Meeting not found" };
      return;
    }
    
    ctx.response.body = { meeting: data };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Create new meeting
router.post("/meetings", authMiddleware, async (ctx) => {
  try {
    const meetingData = await ctx.request.body().value;
    const meeting = {
      ...meetingData,
      user_id: ctx.state.user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from("meetings")
      .insert(meeting)
      .select()
      .single();
    
    if (error) throw error;
    
    ctx.response.status = 201;
    ctx.response.body = { meeting: data };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Update meeting
router.put("/meetings/:id", authMiddleware, async (ctx) => {
  try {
    const { id } = ctx.params;
    const updateData = await ctx.request.body().value;
    
    const { data, error } = await supabase
      .from("meetings")
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("user_id", ctx.state.user.id)
      .select()
      .single();
    
    if (error) throw error;
    
    if (!data) {
      ctx.response.status = 404;
      ctx.response.body = { error: "Meeting not found" };
      return;
    }
    
    ctx.response.body = { meeting: data };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

// Delete meeting
router.delete("/meetings/:id", authMiddleware, async (ctx) => {
  try {
    const { id } = ctx.params;
    
    const { error } = await supabase
      .from("meetings")
      .delete()
      .eq("id", id)
      .eq("user_id", ctx.state.user.id);
    
    if (error) throw error;
    
    ctx.response.body = { message: "Meeting deleted successfully" };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { error: error.message };
  }
});

export { router as meetingsRouter };
