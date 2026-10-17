# Fuel Retail BI & Visualization Platform — Project Introduction (English)

> An end-to-end business-intelligence platform for **fuel retail and wholesale operations** — petrol stations, depots and wholesale customers. It turns a legacy on-premise POS database into automated snapshots, bilingual management reports, live competitor price monitoring, an on-premise AI assistant, and a 3D station map, delivered across **Web, desktop and a desktop wallpaper engine**.

---

## Short pitch (for applications / profiles)

I designed, built and now operate a full business-intelligence platform for a mid-size fuel retail network. It replaced a manual workflow in which staff spent 3–4 hours every day assembling Excel reports by hand from a legacy on-premise point-of-sale database.

The system reads the POS database directly, builds versioned daily and monthly snapshots, serves a Flask + MySQL API behind Nginx, and renders the results in three front ends: a React web dashboard, an Electron desktop client with an auto-update feed, and a desktop wallpaper engine that shows live inventory. It also scrapes competitor fuel prices daily, generates Chinese–Russian bilingual Excel and Word reports, and answers manager questions in natural language through a **locally hosted LLM**, so no operational data ever leaves the network.

80 released versions, bilingual throughout, in continuous production use. This repository is a desensitized public release: all company names, coordinates, customer names and financial figures are synthetic.

---

## 1. Why this project exists

Fuel retail chains in many emerging markets commonly run on legacy on-premise POS software whose reporting is manual, slow and error-prone. In the deployment this system was built for:

- Staff across the network spent **3–4 hours per day** manually assembling Excel reports out of the POS database.
- Management had no single view of sales, inventory, margin or competitor pricing.
- Reports were reconciled by hand, so the same question asked twice could get two different answers.

This platform replaces that workflow with one automated pipeline:

```
POS database → automated snapshots → KPI dashboards → generated Excel / Word reports → management
```

and exposes the same data to a **local LLM assistant**, so non-technical managers can ask questions in Chinese or Russian and get answers grounded in exactly the same reporting rules the system uses for its official numbers.

---

## 2. What it does

### 2.1 Retail operations
- Daily and monthly **retail snapshots** — volume, mass and revenue per station, per fuel grade (АИ-80 / АИ-92 / АИ-95 / diesel / LPG).
- **Data-quality correction**: dirty density readings are detected **row by row** and corrected against per-grade sanity windows. Good and bad rows are separated individually rather than bucketed, so tonnage stays accurate.
- Payment-channel breakdown (cash / card / contract / internal use / complimentary), shift-level integrity checks, and detection of zero-duration shifts that would otherwise silently swallow sales.

### 2.2 Wholesale, transfers and processing
- Unified classification of wholesale, inter-depot transfer (supply) and toll-processing flows, driven by a **single source of truth** for entity identity (station catalogue + customer registry) instead of ad-hoc branching at each call site.
- Transfer tonnage computed from **real measured mass**, with a fallback chain (`Mass → MassTTN → TankerMass`) and no blanket density assumption.

### 2.3 Reporting
- Excel exports with **Chinese–Russian bilingual headers**, merged station-name cells, `#,##0.000` numeric formatting, auto column widths, and validity rules (rows with no sales or movement stay blank).
- Daily management briefings and accounting handover documents generated on schedule.
- Report figures are **versioned and cacheable**, so any month can be recomputed deterministically after a rule change.

### 2.4 Competitor price watch
- Four-tier price sourcing: partner API (live) → per-competitor published price tables parsed from media → official national average anchor → station-manager "sentinel" submissions.
- Hard rule: always carry forward the **latest quote at or before the target date** and label it as carried — a stale price is never presented as a fresh one.
- Listed prices and realised average prices are kept strictly separate; they are never subtracted from one another.

### 2.5 Visualization
- **3D station map** built on a custom lightweight Three.js renderer — no heavy GIS stack. Station and depot markers, inventory-capacity tooltips, region grouping.
- Desktop **wallpaper engine** rendering inventory and map panels directly onto the desktop background.
- Multi-role dashboards with department-scoped permissions.

### 2.6 AI assistant
- Runs a **local LLM**; operational data never leaves the premises.
- Questions are routed by keyword to the retail or wholesale domain, then answered by generated SQL over the reporting layer. Per-grade prices are computed independently for each grade — never blended into a single average.

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
            (React + Vite)   (Electron + Vite)  (native widget)    (inference)
                    └─────────────────┴───────────────┴──────────────────┘
                                          │
                                    Nginx (HTTPS, multi-domain reverse proxy)
```

| Layer | Stack |
| --- | --- |
| Backend | Python + Flask (REST, JSON) |
| Data | MySQL — reporting views and snapshot caches |
| Web frontend | React + Vite + React Router |
| Desktop client | Electron + Vite + React (auto-update feed) |
| Wallpaper engine | Standalone native widget, independent version line |
| Edge | Nginx, HTTPS, multi-domain |
| Shared | Cross-target API contracts, retail core logic, assistant UI |
| AI | Local LLM inference (on-premise) |

**Design rules worth noting**

- **Single source of truth.** Tank↔fuel-grade mapping and station/customer identity live in dictionaries consumed by five separate paths; adding a mapping is one edit plus a validation run, never five branches.
- **Report semantics live in one place.** The same mass/volume/revenue expressions are reused by the Excel export, the report generator and the shared layer.
- **Snapshot-first reads.** Month and year queries hit prebuilt snapshots when all months are closed, and fall back to live SQL only when data is incomplete.

---

## 4. Engineering highlights

1. **Correctness over convenience** — dirty-density correction works per row, not per bucket, and validation scripts assert mapping invariants against an expected count rather than assuming them.
2. **No duplicated business logic** — mapping dictionaries and report expressions are shared across export, generation and UI layers; a semantic change is made once.
3. **Defensive data pipeline** — shift joins use inclusive bounds so zero-duration shifts are caught; daily snapshots persist `status` and `closedReason` so an anomaly is still diagnosable months later.
4. **Honest price sourcing** — carried-forward quotes are explicitly labelled, and a national average is only ingested when it originates from the same article as the matched price table.
5. **On-premise AI** — the assistant runs locally to satisfy the constraint that operational data must not leave the company network.
6. **Bilingual by design** — Chinese and Russian are first-class in the UI, in report headers and in entity naming, including normalization rules for Cyrillic/Latin homoglyphs.

---

## 5. Scale and maturity

- Running in production for a mid-size fuel retail network.
- **80 released versions** (v1.0.0 → v5.6.7) of continuous iteration, preserved as tags in this repository.
- Chinese–Russian bilingual throughout — UI, reports, entity naming.
- Eliminated a 3–4 hour per day manual reporting workload.
- Deployed behind Nginx with HTTPS across multiple domains, with a remote-maintenance path for field support.

---

## 6. Repository layout

| Path | Contents |
| --- | --- |
| `Sales/` | Flask API service and orchestration |
| `OilStation/` | Station data, snapshot builders, report generation |
| `frontend/` | Web frontend (React + Vite) |
| `SalesDesktop/` | Desktop client (Electron + Vite + React) |
| `SalesWallpaperEngine/` | Desktop wallpaper engine |
| `shared/` | Cross-target API contracts and shared logic |
| `scripts/` | Deployment and maintenance scripts |
| `docs/` | Configuration and data-semantics documentation |

---

## 7. Note on this release

This is a **desensitized public release**. All real company names, domains, public IP addresses, station and depot coordinates, customer names, personal names, vehicle plate numbers and financial figures have been replaced with synthetic placeholders across the entire commit history. The repository contains no `.env`, no database dump and no certificates.

Geographic data has been intentionally removed: **station and depot coordinates are zeroed, and the country/region GeoJSON basemap is not included** — anyone deploying this must supply their own geodata (see `OilStation/kgz.geojson.template`).

Fuel-grade names (АИ-80/92/95, diesel, LPG) and generic petroleum/chemical terminology are retained as-is: they are standard domain vocabulary, not company information.

---

## 8. Maintainer and contact

- **Maintainer**: Юрий
- **Email**: 631131066@qq.com
- **Telegram**: +996555883019

Bug reports, deployment questions and feature discussions are welcome through any of the channels above.

---

## 9. License

Released under the **MIT License**.
