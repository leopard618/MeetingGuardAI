import { Router } from "oak";

const router = new Router();

// Get calendar events (mock data for now)
router.get("/calendar/events", (ctx) => {
  // Mock calendar events
  const events = [
    {
      id: "1",
      title: "Team Meeting",
      start: new Date(Date.now() + 3600000).toISOString(),
      end: new Date(Date.now() + 7200000).toISOString(),
      description: "Weekly team sync"
    },
    {
      id: "2", 
      title: "Client Call",
      start: new Date(Date.now() + 86400000).toISOString(),
      end: new Date(Date.now() + 90000000).toISOString(),
      description: "Project discussion"
    }
  ];
  
  ctx.response.body = { events };
});

// Sync calendar
router.post("/calendar/sync", (ctx) => {
  // Mock sync response
  ctx.response.body = {
    message: "Calendar sync initiated",
    status: "syncing",
    lastSync: new Date().toISOString()
  };
});

// Get calendar sync status
router.get("/calendar/status", (ctx) => {
  ctx.response.body = {
    connected: true,
    provider: "google",
    lastSync: new Date().toISOString(),
    nextSync: new Date(Date.now() + 300000).toISOString()
  };
});

// Disconnect calendar
router.post("/calendar/disconnect", (ctx) => {
  ctx.response.body = {
    message: "Calendar disconnected successfully"
  };
});

export { router as calendarRouter };
