import { env } from "../env";
import { db } from "../db";
import { writeAuditLog } from "./audit";

/**
 * Section 9 — Microsoft Teams Integration.
 *
 * Every clock-in/out posts an Adaptive Card to the "CHS - Time Logs"
 * channel (Manager + Admin membership only) via an Incoming Webhook.
 * This is intentionally fire-and-forget with retry/backoff: a Teams
 * outage or throttling must never block the TimeEvent write itself, so
 * callers create the TimeEvent row FIRST, then call
 * postClockEventToTeams(...) without awaiting it on the request path.
 *
 * To move from an Incoming Webhook to Microsoft Graph
 * (POST /teams/{team-id}/channels/{channel-id}/messages) for
 * richer per-team routing/threading, swap the fetch() below for a
 * Graph client call using an app registration with
 * ChannelMessage.Send permission — the retry/audit-log wrapper and the
 * Adaptive Card payload builder stay the same either way.
 */

interface ClockEventForTeams {
  timeEventId: string;
  userId: string;
  userName: string;
  eventType: "IN" | "OUT";
  timestampUtc: Date;
  hoursWorkedToday?: number | null;
}

function buildAdaptiveCard(evt: ClockEventForTeams) {
  const localTime = evt.timestampUtc.toLocaleString("en-IE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const title = evt.eventType === "IN" ? "🟢 Clocked In" : "🔴 Clocked Out";
  const facts = [
    { title: "Employee", value: evt.userName },
    { title: "Event", value: evt.eventType === "IN" ? "Clocked In" : "Clocked Out" },
    { title: "Time", value: `${localTime} (local) / ${evt.timestampUtc.toISOString()} (UTC)` },
  ];
  if (evt.eventType === "OUT" && evt.hoursWorkedToday != null) {
    facts.push({ title: "Hours worked today", value: `${evt.hoursWorkedToday.toFixed(2)}h` });
  }

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", size: "Medium", weight: "Bolder", text: title },
            { type: "FactSet", facts },
          ],
          actions: [
            {
              type: "Action.OpenUrl",
              title: "View in Portal",
              url: `${env.teams.portalBaseUrl}/team?userId=${evt.userId}`,
            },
          ],
        },
      },
    ],
  };
}

async function attemptPost(payload: unknown): Promise<{ ok: boolean; status?: number }> {
  if (!env.teams.webhookUrl) {
    return { ok: false, status: undefined };
  }
  try {
    const res = await fetch(env.teams.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false };
  }
}

const RETRY_DELAYS_MS = [1000, 4000, 15000]; // simple backoff, 3 attempts total after the first

export async function postClockEventToTeams(evt: ClockEventForTeams): Promise<void> {
  const payload = buildAdaptiveCard(evt);

  if (!env.teams.webhookUrl) {
    await writeAuditLog({
      userId: null,
      action: "TeamsPostSkipped",
      targetId: evt.timeEventId,
      metadata: { reason: "TEAMS_WEBHOOK_URL not configured" },
    });
    return;
  }

  let result = await attemptPost(payload);
  let attempts = 1;

  for (const delay of RETRY_DELAYS_MS) {
    if (result.ok) break;
    await new Promise((r) => setTimeout(r, delay));
    result = await attemptPost(payload);
    attempts += 1;
  }

  if (result.ok) {
    // Incoming Webhooks don't return a message id in their response
    // body (just "1"), so we record delivery success rather than a
    // real message id. Swap in the Graph API call above to get a real
    // id back for threaded corrections.
    await db
      .updateTable("TimeEvent")
      .set({ teamsMessageId: `webhook-delivered-${Date.now()}`, teamsPostError: null })
      .where("id", "=", evt.timeEventId)
      .execute()
      .catch(() => void 0);
  } else {
    const errorMsg = `Failed after ${attempts} attempt(s), last status=${result.status ?? "network error"}`;
    await db
      .updateTable("TimeEvent")
      .set({ teamsPostError: errorMsg })
      .where("id", "=", evt.timeEventId)
      .execute()
      .catch(() => void 0);
    await writeAuditLog({
      userId: null,
      action: "TeamsPostFailed",
      targetId: evt.timeEventId,
      metadata: { error: errorMsg },
    });
  }
}
