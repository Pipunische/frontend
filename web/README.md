# PoluPoker SPA (`web/`)

React + Vite + TypeScript client for the `rewrite/spa` branch.

## Dev

```powershell
# Terminal 1 — BFF
cd c:\Dev\Polupoker-spa
$env:SPA_DEV = "1"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 — SPA
cd c:\Dev\Polupoker-spa\web
npm run dev
```

Open http://127.0.0.1:5173

See [../SPA_MIGRATION.md](../SPA_MIGRATION.md) for the full migration plan.
