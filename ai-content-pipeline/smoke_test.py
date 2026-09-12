"""Quick smoke test of the dashboard using Flask's built-in test client.
Works on a fresh clone: it triggers a run first, so no prior data is needed.
Run: python smoke_test.py"""
import dashboard.app as a

client = a.app.test_client()
TOPIC = "Faster intake approvals"

# 1) Trigger a run via POST -> should 302 redirect back to /.
r = client.post("/run", data={"topic": TOPIC})
assert r.status_code in (302, 303), r.status_code
print("POST /run        -> 302 redirect (pipeline executed)")

# 2) Homepage renders every section for the new campaign.
r = client.get("/")
html = r.get_data(as_text=True)
assert r.status_code == 200, r.status_code
for needle in ["SIGNAL<b>LOOP</b>", "Segment performance", "AI performance summary",
               "Headline A/B options", "Avg click", "Click rate", TOPIC]:
    assert needle in html, f"missing: {needle}"
print("GET /            -> 200, all sections present, new campaign visible")
print("\nDASHBOARD SMOKE TEST PASSED")
