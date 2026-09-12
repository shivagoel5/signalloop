"""Central configuration. Reads from environment (.env) with safe defaults
so the whole pipeline runs with zero setup in MOCK mode."""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:  # dotenv is optional; env vars still work without it
    pass

# --- Paths ---------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
RUNS_DIR = DATA_DIR / "runs"
DB_PATH = DATA_DIR / "pipeline.db"
CONTACTS_PATH = DATA_DIR / "contacts.json"

RUNS_DIR.mkdir(parents=True, exist_ok=True)

# --- LLM -----------------------------------------------------------------
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514").strip()
LLM_LIVE = bool(ANTHROPIC_API_KEY)

# --- HubSpot -------------------------------------------------------------
HUBSPOT_ACCESS_TOKEN = os.getenv("HUBSPOT_ACCESS_TOKEN", "").strip()
HUBSPOT_MODE = os.getenv("HUBSPOT_MODE", "mock").strip().lower()
HUBSPOT_LIVE = HUBSPOT_MODE == "live" and bool(HUBSPOT_ACCESS_TOKEN)
HUBSPOT_BASE_URL = "https://api.hubapi.com"

# --- Simulation ----------------------------------------------------------
_seed = os.getenv("SIM_SEED", "42").strip()
SIM_SEED = int(_seed) if _seed.isdigit() else None


def mode_banner() -> str:
    """One-line summary of live vs mock subsystems, printed at startup."""
    return (
        f"LLM={'LIVE (Claude)' if LLM_LIVE else 'MOCK'} | "
        f"CRM={'LIVE (HubSpot)' if HUBSPOT_LIVE else 'MOCK'} | "
        f"sim_seed={SIM_SEED}"
    )
