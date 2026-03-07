# Accumulate Identity Scope

A full-stack application for crawling, mapping, and visualizing the identity hierarchy of the [Accumulate](https://accumulatenetwork.io) blockchain. It consists of two parts: a **crawler** that traverses the Accumulate mainnet to build a structured SQLite database of ADIs, accounts, key books, authorities, and delegation relationships, and an **explorer** web application that provides interactive visualizations of the resulting data.

## Architecture

```
identity_tree_mapper/
  *.py                  Crawler — Python CLI that queries the Accumulate API
  explorer/
    server/             Backend — FastAPI serving a read-only SQLite API
    client/             Frontend — React + TypeScript + Vite SPA
```

### Crawler

The crawler runs in two phases against the Accumulate JSON-RPC API:

1. **Phase 1 — Directory Crawl**: Starting from a source database of known ADI URLs, recursively resolves each ADI's directory entries (token accounts, data accounts, key books, sub-ADIs) and authority records. Handles pagination, rate limiting, and resume-on-failure.
2. **Phase 2 — Key Page Details**: For every key book discovered in Phase 1, fetches individual key pages to extract public key hashes, thresholds, delegate references, and credit balances.

The output is a self-contained SQLite database (`identity_tree_complete.db`) containing seven normalized tables covering the full identity tree.

### Explorer Backend

A lightweight FastAPI application (`explorer/server/`) that opens the crawler's SQLite database in read-only mode and exposes REST endpoints:

| Route | Description |
|---|---|
| `GET /api/stats` | Aggregate counts and distributions |
| `GET /api/adis` | Paginated ADI listing with search |
| `GET /api/adis/{url}` | Full ADI detail including children and accounts |
| `GET /api/adis/tree` | Hierarchical tree for a root ADI |
| `GET /api/token-accounts` | Token account listing with filters |
| `GET /api/data-accounts` | Data account listing |
| `GET /api/token-issuers` | Token issuer summary |
| `GET /api/key-books` | Key book listing |
| `GET /api/key-books/{url}` | Key book detail with pages |
| `GET /api/key-pages` | Key page listing |
| `GET /api/authorities` | Authority record listing |
| `GET /api/authorities/flows` | Aggregated authority flow data |
| `GET /api/search` | Cross-entity full-text search |
| `GET /api/intelligence` | Security analytics and risk heatmaps |
| `GET /api/network/summary` | Network-level summary |
| `GET /api/network/topology` | Full topology graph (nodes + edges) |

### Explorer Frontend

A React single-page application built with Vite, featuring eight views:

- **Command Center** — Dashboard with aggregate stats, distribution charts, and a topology minimap
- **Network Graph** — Interactive force-directed graph of the full ADI topology with color-by modes, edge filtering, search highlighting, and a minimap
- **Identity Explorer** — Hierarchical tree browser with per-ADI detail panels covering accounts, security posture, and authority flows
- **Accounts** — Filterable browser for token accounts, data accounts, and token issuers with distribution analytics
- **Key Vault** — Key book and key page explorer with a shared-key graph visualization
- **Authority Flows** — Sankey diagrams, chord diagrams, and delegation flow visualizations
- **Intelligence** — Risk heatmaps, key-reuse cluster detection, authority concentration analysis (Gini/Lorenz), and comparative radar charts
- **Search** — Global search across all entity types

The UI supports both dark and light themes with automatic system preference detection.

## Prerequisites

- Python 3.10+ (crawler and backend)
- Node.js 18+ and npm (frontend)

## Quick Start

### 1. Run the Crawler

```bash
# Install crawler dependencies
pip install aiohttp aiosqlite

# Run both phases against Accumulate mainnet
python -m identity_tree_mapper --phase all --output-db identity_tree_complete.db

# Or run a specific phase
python -m identity_tree_mapper --phase 1   # directory crawl only
python -m identity_tree_mapper --phase 2   # key page details only
```

Crawler options:

```
--endpoint URL       Accumulate API endpoint (default: mainnet)
--source-db PATH     Input database of known ADI URLs
--output-db PATH     Output SQLite database path
--rate-limit N       Requests per second (default: 8)
--phase {1,2,all}    Which crawl phase to run
--fresh              Ignore resume state and start over
--gui                Launch the simple GUI monitor
```

### 2. Start the Explorer

```bash
# Install backend dependencies
cd explorer
pip install fastapi uvicorn

# Install frontend dependencies and build
cd client
npm install
npm run build
cd ..

# Start the server (serves both API and frontend)
python run_explorer.py
```

The explorer will be available at `http://localhost:8050`.

### 3. Development Mode

For frontend development with hot reload:

```bash
# Terminal 1 — backend
cd explorer
python run_explorer.py

# Terminal 2 — frontend dev server
cd explorer/client
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies `/api` requests to the backend.

## Deployment

### Backend (Docker)

```bash
cd explorer
docker build -t identity-scope-api .
docker run -d -p 8060:8060 --restart unless-stopped identity-scope-api
```

### Frontend (Vercel)

The `explorer/client` directory contains a `vercel.json` configured to proxy API requests to the backend. Set the root directory to `explorer/client` when importing the project in Vercel.

## Database Schema

| Table | Key Columns |
|---|---|
| `adis` | url, parent_url, crawl_status, directory_json |
| `token_accounts` | url, adi_url, token_url, balance |
| `data_accounts` | url, adi_url, entry_count |
| `token_issuers` | url, adi_url, symbol, precision, supply_limit |
| `key_books` | url, adi_url, page_count |
| `key_pages` | url, key_book_url, keys_json, threshold, credit_balance |
| `account_authorities` | account_url, authority_url, is_implied |

## License

MIT
