import { defineApp } from "convex/server";

import betterAuth from "./betterAuth/convex.config";

const app = defineApp();

// Better Auth component for authentication
app.use(betterAuth);

export default app;
