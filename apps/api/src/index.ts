import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./env";
import { authRouter } from "./routes/auth";
import { meRouter } from "./routes/me";
import { timeRouter } from "./routes/time";
import { calendarRouter } from "./routes/calendar";
import { holidaysRouter } from "./routes/holidays";
import { hrRequestsRouter } from "./routes/hrRequests";
import { policiesRouter } from "./routes/policies";
import { workspacesRouter } from "./routes/workspaces";
import { availabilityRouter } from "./routes/availability";
import { payslipsRouter } from "./routes/payslips";
import { payrollRouter } from "./routes/payroll";
import { auditLogRouter } from "./routes/auditLog";
import { usersRouter } from "./routes/users";
import { filesRouter } from "./routes/files";
import { announcementsRouter } from "./routes/announcements";
import { notificationsRouter } from "./routes/notifications";
import { startScheduler } from "./utils/scheduler";

const app = express();

app.use(
  cors({
    origin: env.webOrigin,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true, service: "chs-api" }));

app.use("/auth", authRouter);
app.use("/me", meRouter);
app.use("/time", timeRouter);
app.use("/calendar", calendarRouter);
app.use("/holidays", holidaysRouter);
app.use("/hr-requests", hrRequestsRouter);
app.use("/policies", policiesRouter);
app.use("/workspaces", workspacesRouter);
app.use("/availability", availabilityRouter);
app.use("/payslips", payslipsRouter);
app.use("/payroll", payrollRouter);
app.use("/audit-log", auditLogRouter);
app.use("/users", usersRouter);
app.use("/files", filesRouter);
app.use("/announcements", announcementsRouter);
app.use("/notifications", notificationsRouter);

// Centralized error handler — keep failures as JSON, never leak stack traces.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err?.status ?? 500).json({ error: err?.message ?? "Internal server error" });
});

app.listen(env.apiPort, () => {
  console.log(`CHS API listening on http://localhost:${env.apiPort}`);
  console.log(`CORS allowing origin: ${env.webOrigin}`);
});

startScheduler();
