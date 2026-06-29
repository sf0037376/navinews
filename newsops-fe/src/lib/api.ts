// Shared API base URL — reads NEXT_PUBLIC_API_URL at runtime (set in Vercel/Render env vars)
// Falls back to local dev backend when not set
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
