import test from "node:test";
import assert from "node:assert/strict";

import handler from "../functions/run.mjs";
import { CHANNEL_MIX } from "../lib/channels.mjs";
import { CONTACT_PROPERTIES, HubSpotClient } from "../lib/hubspot.mjs";
import { PROFILES, runPipeline } from "../lib/pipeline.mjs";

for (const [key, profile] of Object.entries(PROFILES)) {
  test(`${key}: one run produces a complete multi-channel report in mock CRM mode`, async () => {
    const hubspot = new HubSpotClient();
    const { report, history, crmState } = await runPipeline({ companyKey: key, hubspot, seed: 42 });

    assert.equal(report.company, profile.name);
    assert.equal(report.mode.crm, "mock");
    assert.equal(report.metrics.length, profile.personas.length);
    assert.equal(history.length, 1);
    assert.ok(hubspot.requestLog.every((r) => r.status === "MOCK"));

    // First run creates the contact properties and one static list per audience.
    const propertyCreates = hubspot.requestLog.filter((r) => r.method === "POST" && r.path === "/crm/v3/properties/contacts");
    assert.equal(propertyCreates.length, CONTACT_PROPERTIES.length);
    assert.equal(Object.keys(crmState.lists).length, profile.personas.length);
    assert.equal(crmState.propertiesReady, true);

    // Only this company's sample contacts are upserted, once, with SignalLoop properties set.
    const segments = new Set(profile.personas.map((p) => p.segment));
    const upsert = hubspot.requestLog.find((r) => r.path === "/crm/v3/objects/contacts/batch/upsert");
    assert.ok(upsert.body.inputs.length > 0);
    for (const input of upsert.body.inputs) {
      assert.ok(segments.has(input.properties.persona));
      assert.ok(input.id.endsWith("@example.com"));
      assert.ok(input.properties.signalloop_last_newsletter);
      assert.match(input.properties.signalloop_last_campaign, /^cmp_/);
    }
    assert.equal(report.crm.simulated_sends, upsert.body.inputs.length);

    // Every contact lands in its audience's static list.
    const added = hubspot.requestLog.filter((r) => r.method === "PUT" && r.path.endsWith("/memberships/add"));
    assert.equal(added.reduce((n, r) => n + r.body.length, 0), upsert.body.inputs.length);

    for (const m of report.metrics) {
      assert.ok(m.click_rate <= m.open_rate, `${m.persona}: clicks cannot exceed opens`);
      const expected = ["email", ...Object.keys(CHANNEL_MIX[key][m.persona_id].channels)];
      assert.deepEqual(m.channels.map((c) => c.channel), expected);
      assert.ok(expected.includes(m.best_channel));
    }
    assert.equal(report.optimization.by_audience.length, profile.personas.length);
    assert.ok(report.optimization.by_audience.every((a) => a.next_topic && a.best_channel_label));
  });
}

test("repeat runs reuse saved CRM state and skip property and list setup", async () => {
  const first = await runPipeline({ companyKey: "ramp", hubspot: new HubSpotClient() });
  const hubspot = new HubSpotClient();
  await runPipeline({ companyKey: "ramp", hubspot, crmState: first.crmState, history: first.history });
  const calls = hubspot.requestLog.map((r) => `${r.method} ${r.path.replace(/lists\/\d+/, "lists/{id}")}`);
  assert.deepEqual([...new Set(calls)].sort(), [
    "POST /crm/v3/objects/contacts/batch/upsert",
    "PUT /crm/v3/lists/{id}/memberships/add",
  ]);
});

test("the same seed reproduces the same engagement", async () => {
  const a = await runPipeline({ companyKey: "square", hubspot: new HubSpotClient(), seed: 7 });
  const b = await runPipeline({ companyKey: "square", hubspot: new HubSpotClient(), seed: 7 });
  assert.deepEqual(a.report.metrics, b.report.metrics);
});

test("history accumulates, tolerates runs saved before channels existed", async () => {
  const legacyRun = {
    campaign_id: "cmp_legacy",
    at: "2026-09-12T00:00:00.000Z",
    metrics: PROFILES.square.personas.map((p) => ({ persona_id: p.id, open_rate: 0.4, click_rate: 0.1, unsub_rate: 0.01 })),
  };
  let history = [legacyRun];
  let report;
  for (let i = 0; i < 2; i++) {
    ({ report, history } = await runPipeline({ companyKey: "square", history, hubspot: new HubSpotClient() }));
  }
  const names = PROFILES.square.personas.map((p) => p.name);
  assert.equal(report.loop.run_number, 3);
  assert.ok(report.loop.averages.every((a) => a.runs === 3));
  assert.ok(report.loop.averages.every((a) => a.channels.every((c) => c.runs === 2)));
  assert.ok(names.includes(report.loop.leader));
  assert.ok(report.optimization.rationale.startsWith(report.loop.leader));
});

test("live mode: creates missing properties, falls back to an existing list, adds upserted ids", async () => {
  const calls = [];
  const reply = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status });
  const fakeFetch = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path, body, auth: init.headers.Authorization });
    if (init.method === "GET" && path.startsWith("/crm/v3/properties/contacts/")) return reply(404, { message: "not found" });
    if (init.method === "POST" && path === "/crm/v3/properties/contacts") return reply(201, { name: body.name });
    if (path === "/crm/v3/objects/contacts/batch/upsert") {
      return reply(200, { status: "COMPLETE", results: body.inputs.map((i, n) => ({ id: String(900 + n), properties: { email: i.id.toUpperCase() } })) });
    }
    if (init.method === "POST" && path === "/crm/v3/lists") return reply(400, { message: "list name already exists" });
    if (init.method === "GET" && path.startsWith("/crm/v3/lists/object-type-id/0-1/name/")) return reply(200, { list: { listId: "77" } });
    if (init.method === "PUT" && path === "/crm/v3/lists/77/memberships/add") return reply(200, { recordIdsAdded: body });
    return reply(500, { message: `unexpected ${init.method} ${path}` });
  };

  const hubspot = new HubSpotClient({ token: "test-token", mode: "live", fetchImpl: fakeFetch });
  const { report, crmState } = await runPipeline({ companyKey: "ramp", hubspot, seed: 1 });

  assert.equal(report.mode.crm, "live");
  assert.ok(calls.every((c) => c.auth === "Bearer test-token"));
  assert.equal(calls.filter((c) => c.path === "/crm/v3/properties/contacts").length, CONTACT_PROPERTIES.length);
  assert.ok(Object.values(crmState.lists).every((id) => id === "77"));
  const addedIds = calls.filter((c) => c.method === "PUT").flatMap((c) => c.body).sort();
  assert.deepEqual(addedIds, Array.from({ length: 10 }, (_, n) => String(900 + n)).sort());
});

test("live mode: a property created concurrently (409) is fine; other HubSpot errors carry safe details", async () => {
  const reply = (status, body) => new Response(JSON.stringify(body), { status });
  const conflictFetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (init.method === "GET") return reply(404, { message: "not found" });
    if (path === "/crm/v3/properties/contacts") return reply(409, { category: "CONFLICT", message: "exists" });
    return reply(200, {});
  };
  await new HubSpotClient({ token: "t", mode: "live", fetchImpl: conflictFetch }).ensureContactProperties();

  const forbiddenFetch = async () => reply(403, { category: "MISSING_SCOPES", message: "This app hasn't been granted all required scopes" });
  const err = await new HubSpotClient({ token: "t", mode: "live", fetchImpl: forbiddenFetch })
    .ensureContactProperties().catch((e) => e);
  assert.deepEqual(err.toDetail(), {
    step: "GET /crm/v3/properties/contacts/persona",
    status: 403,
    category: "MISSING_SCOPES",
    message: "This app hasn't been granted all required scopes",
  });
  assert.ok(!JSON.stringify(err.toDetail()).includes("Bearer"));
});

test("handler: POST runs a loop, GET returns saved history, bad input is rejected", async () => {
  const post = (body) => handler(new Request("http://localhost/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

  const first = await post({ company: "ramp" });
  assert.equal(first.status, 200);
  const report = await first.json();
  assert.equal(report.company, "Ramp");
  assert.ok(report.channels.some((c) => c.key === "linkedin"));

  const second = await (await post({ company: "ramp" })).json();
  assert.ok(second.crm.requests.every((r) => !r.path.startsWith("/crm/v3/properties")), "setup calls are skipped once state is saved");

  const hist = await handler(new Request("http://localhost/api/run?company=ramp"));
  assert.equal(hist.status, 200);
  assert.ok((await hist.json()).runs >= 2);

  assert.equal((await post({ company: "zip" })).status, 400);
  assert.equal((await post({ company: "__proto__" })).status, 400);
  assert.equal((await handler(new Request("http://localhost/api/run", { method: "PUT" }))).status, 405);
});
