# Fuel Retail BI & Visualization Platform — Project Introduction (English)

> An end-to-end business-intelligence and visualization platform built for **fuel retail and wholesale operations** (petrol stations, depots, wholesale customers). It aggregates point-of-sale data, produces bilingual management reports, monitors competitor fuel prices, and renders a 3D station map — delivered across **Web, desktop (Electron), and a desktop wallpaper engine**, backed by a Flask + MySQL service behind Nginx HTTPS.

---

## 1. Why this project exists

Retail fuel chains in emerging markets typically run on legacy on-premise POS software whose reporting is manual and slow. In the deployment this system was built for, staff at **a mid-size fuel retail network** spent **3–4 hours every day** manually assembling Excel reports from the POS database, and management had no single view of sales, inventory, margin, or competitor pricing.

This platform replaces that workflow with an automated pipeline:
POS database → automated snapshots → KPI dashboards → generated Excel/Word reports → delivered to management,

with data also exposed through a **local LLM assistant** so non-technical managers can ask questions in Chinese or Russian and get answers grounded in the same reporting rules the system uses.

---

## 2. What it does

### Retail operations
- Daily and monthly **retail snapshots** (volume, mass, revenue) per station, per fuel grade (АИ-80 / АИ-92 / АИ-95 / diesel / LPG).
- **Data-quality correction**: dirty density readings are detected per-row and corrected against per-grade sanity windows; good and bad rows are separated rather than bucketed, so tonnage stays accurate.
- Payment-channel breakdown (cash / card / contract / internal use / complimentary), shift-level integrity checks, and detection of zero-length shifts that silently swallow sales.

### Wholesale, transfers and processing
- Unified classification of wholesale, inter-depot transfer (supply), and toll-processing flows, driven by a single source of truth for entity names (station catalogue + customer registry) instead of ad-hoc branching.
- Tonnage for transfers computed from real measured mass, with fallback chains (`Mass → MassTTN → TankerMass`) and no blanket density assumption.

### Reporting
- Excel exports with **Chinese–Russian bilingual headers**, merged station-name cells, `#,##0.000` numeric formatting, auto column widths, and validity rules (rows with no sales/movement are left blank).
- Daily management briefing and accounting handover documents generated on schedule.
- Report figures are versioned and cacheable, so a month can be recomputed deterministically after a rule change.

### Competitor price watch
- Four-tier price sourcing: partner API (live) → per-competitor published price tables scraped from media → official national average anchor → station-manager "sentinel" submissions.
- Rule: always carry forward the **latest quote at or before the target date** and mark it as carried — never present a stale price as a fresh one.
- Listed prices and realised average prices are kept strictly separate (they are never subtracted from one another).

### Visualization
- **3D station map** (custom lightweight Three.js renderer, no heavy GIS stack): station and depot markers, inventory capacity tooltips, region grouping.
- Desktop **wallpaper engine** that renders inventory and map panels directly on the desktop background.
- Multi-role dashboards with department-scoped permissions.

### AI assistant
- Runs a **local LLM** (data never leaves the premises). Questions are routed by keyword to retail or wholesale domain, then answered by generated SQL over the reporting layer, with per-grade pricing computed independently rather than averaged.

---

## 3. Architecture

```
POS / MySQL  ──►  Python snapshot builders  ──►  cached snapshots (daily / monthly)
                                                      │
                                                      ▼
                                          Flask API service (127.0.0.1:8900)
                                                      │
                    ┌─────────────────┬───────────────┼──────────────────┐
                    ▼                 ▼               ▼                  ▼
             Web frontend      Desktop client   Wallpaper engine   Local LLM
            (React + Vite)   (Electron+Vite)    (native widget)    (inference)
                    └─────────────────┴───────────────┴──────────────────┘
                                          │
                                    Nginx (HTTPS, multi-domain reverse proxy)
```

| Layer | Stack |
| --- | --- |
| Backend | Python + Flask (REST, JSON) |
| Data | MySQL (reporting views, snapshot caches) |
| Web frontend | React + Vite + React Router |
| Desktop client | Electron + Vite + React (auto-update feed) |
| Wallpaper engine | Standalone native widget, independent version line |
| Edge | Nginx, HTTPS, multi-domain |
| Shared | Cross-target API contracts, retail core logic, assistant UI |
| AI | Local LLM inference (on-premise) |

**Design rules worth noting**
- Single source of truth for tank↔fuel-grade mapping and station/customer identity — five consumption paths are dictionary-driven rather than branched per call site, so a mapping change is one edit plus a validation run.
- Report semantics live in one place; the same expressions are reused by the export path, the generator, and the shared layer.
- Snapshot-first reads: month/year queries hit prebuilt snapshots when all months are closed, and fall back to live queries only when data is incomplete.

---

## 4. Scale and maturity

- Deployed and running in production, serving **a mid-size fuel retail network**.
- **80 released versions** (v1.0.0 → v5.6.7) of iterative development, tracked as tags in this repository.
- Chinese–Russian bilingual throughout (UI, reports, entity naming).
- Replaced a 3–4 hour/day manual reporting process per station network.
- Operated behind Nginx with HTTPS across multiple domains, plus a remote desktop maintenance path.

---

## 5. Engineering highlights

1. **Correctness over convenience** — dirty-density correction works per row instead of per bucket; validation scripts assert the mapping invariants (expected count checked, not assumed).
2. **No duplicate business logic** — mapping dictionaries and report expressions are shared across export, generation, and UI layers; a change is made once.
3. **Defensive data pipeline** — shift joins use inclusive bounds to catch zero-duration shifts; daily snapshots record `status`/`closedReason` so anomalies are diagnosable after the fact.
4. **Honest price sourcing** — carried-forward quotes are explicitly labelled; national averages are only ingested when they come from the same article as the matched price table.
5. **On-premise AI** — the assistant runs locally, matching the constraint that operational data must not leave the company network.

---

## 6. Repository contents

| Path | Contents |
| --- | --- |
| `Sales/` | Flask API service and orchestration |
| `OilStation/` | Station data, snapshot builders, report generation |
| `frontend/` | Web frontend (React + Vite) |
| `SalesDesktop/` | Desktop client (Electron + Vite + React) |
| `SalesWallpaperEngine/` | Wallpaper engine |
| `shared/` | Cross-target API contracts and shared logic |
| `scripts/` | Deployment and maintenance scripts |
| `docs/` | Configuration and data-semantics documentation |

---

## 7. Note on this release

This is a **desensitized public release**. All real company names, domains, public IPs, station coordinates, customer names, and financial figures have been replaced with synthetic placeholders. The repository contains no `.env`, no database dump, and no certificates.

Geo data has been intentionally removed: **station/depot coordinates are zeroed and the country/region GeoJSON basemap is not included** — anyone deploying this must supply their own geodata. Fuel-grade names (АИ-80/92/95, diesel, LPG) and generic petroleum/chemical terminology are retained as-is, since they are standard domain vocabulary rather than company information.

---

## 8. License

Released under the **MIT License**.
