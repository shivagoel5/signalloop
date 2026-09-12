import test from "node:test";
import assert from "node:assert/strict";

import handler from "../functions/run.mjs";
import { HubSpotClient } from "../lib/hubspot.mjs";
import { PROFILES, runPipeline } from "../lib/pipeline.mjs";

for (const [key, profile] of Object.entries(PROFILES)) {
  test(`${key}: one run produces a complete report in mock CRM mode`, async () => {
    const hubspot = new HubSpotClient();
    const { report, history } = await runPipeline({ companyKey: key, hubspot, seed: 42 });

    assert.equal(report.company, profile.name);
    assert.equal(report.mode.crm, "mock");
    assert.equal(report.metrics.length, profile.personas.length);
    assert.equal(report.newsletters.length, profile.personas.length);
    assert.equal(history.length, 1);

    // Only this company's sample contacts go to the CRM, once, in a single batch.
    const segments = new Set(profile.personas.map((p) => p.segment));
    const upsert = hubspot.requestLog.find((r) => r.url.endsWith("/contacts/batch/upsert"));
    assert.ok(upsert.payload.inputs.length > 0);
    assert.ok(upsert.payload.inputs.every((i) => segments.has(i.properties.persona)));
    assert.ok(upsert.payload.inputs.every((i) => i.id.endsWith("@example.com")));
    assert.ok(hubspot.requestLog.every((r) => r.status === "MOCK"));
    assert.equal(report.crm.request_count, hubspot.requestLog.length);

    for (const m of report.metrics) {
      assert.ok(m.click_rate <= m.open_rate, `${m.persona}: clicks cannot exceed opens`);
      assert.ok(m.delivered <= m.sent);
    }
  });
}

test("the same seed reproduces the same engagement", async () => {
  const a = await runPipeline({ companyKey: "ramp", hubspot: new HubSpotClient(), seed: 7 });
  const b = await runPipeline({ companyKey: "ramp", hubspot: new HubSpotClient(), seed: 7 });
  assert.deepEqual(a.report.metrics, b.report.metrics);
});

test("history accumulates and the rationale names this company's leading audience", async () => {
  let history = [];
  let report;
  for (let i = 0; i < 3; i++) {
    ({ report, history } = await runPipeline({ companyKey: "square", history, hubspot: new HubSpotClient() }));
  }
  const names = PROFILES.square.personas.map((p) => p.name);
  assert.equal(report.loop.run_number, 3);
  assert.ok(report.loop.averages.every((a) => a.runs === 3));
  assert.ok(names.includes(report.loop.leader));
  assert.ok(report.optimization.rationale.startsWith(report.loop.leader));
  assert.match(report.summary.summary, /Across 3 runs/);
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

  const hist = await handler(new Request("http://localhost/api/run?company=ramp"));
  assert.equal(hist.status, 200);
  assert.ok((await hist.json()).runs >= 1);

  assert.equal((await post({ company: "zip" })).status, 400);
  assert.equal((await post({ company: "__proto__" })).status, 400);
  assert.equal((await handler(new Request("http://localhost/api/run", { method: "PUT" }))).status, 405);
});
