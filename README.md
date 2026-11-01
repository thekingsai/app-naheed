# Naheed Health

Private family health app for Naheed Saif, served at naheed.thekings.ai.

## How it works
- **Sign-in:** one password box, one password per person. Imran's and Salman's passwords open the full app and label their Ask AI questions with their name; Naheed's password opens her simple view only. Sessions are signed cookies that renew on every visit, so people stay signed in until they sign out. Ten wrong tries in 15 minutes locks that connection out.
- **Data:** `data/` holds the app pages, the Ask AI record and every original report PDF, all encrypted (AES-256-GCM). The key lives only in the server's `DATA_KEY` setting.
- **Database:** chats, notes learned from chats and family uploads are stored in the `naheed` schema of the health database, reachable only through the `naheed_api` function with the server secret.
- **Ask AI:** `app/api/ask` sends the rules, the full record and the family notes to the model, streams the answer back, saves the turn to the shared history and extracts new family notes (`lib/learn.js`).

## Server settings
| Name | What it is |
|---|---|
| `SESSION_SECRET` | Signs sign-in cookies |
| `DATA_KEY` | Decrypts `data/` (hex, 32 bytes) |
| `PW_IMRAN_SHA256`, `PW_SALMAN_SHA256`, `PW_MOM_SHA256` | SHA-256 of each person's password (Imran's and Salman's fall back to built-in hashes if unset) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Health database address and public key |
| `DB_API_SECRET` | Secret checked by `naheed_api` |
| `ANTHROPIC_API_KEY` | Model key for Ask AI (optional; otherwise the key saved in the app's Settings is used) |

## Updating the records
The data bundle is rebuilt from the project folder (`app-naheed/output`, `source-data`) and committed; Vercel redeploys on every push.
