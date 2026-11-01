# Naheed Health

Private family health app for Naheed Saif, served at naheed.thekings.ai.

## How it works
- **Uploads:** files go up in 3 MB pieces (the host limits each request to 4.5 MB; photos are shrunk first). Each upload is read by the AI, then the person who uploaded it confirms or flags the reading. Confirmed uploads feed Ask AI right away; charts and tiles update at the next data refresh.
- **Sign-in:** one password box, one password per person. Imran's and Salman's passwords open the full app and label their Ask AI questions with their name; Naheed's password opens her simple view only. Sessions are signed cookies that renew on every visit, so people stay signed in until they sign out. Ten wrong tries in 15 minutes locks that connection out.
- **Data:** `data/` holds the app pages, the Ask AI record and every original report PDF, all encrypted (AES-256-GCM). The key lives only in the server's `DATA_KEY` setting.
- **Scan images:** every RadNet exam's images (about 2,600 JPEGs, ~200 MB) are encrypted the same way and kept as static files in `public/i/` (named by a hash of the image path), which keeps them out of the server function. `/api/doc` fetches and decrypts them for signed-in family only. The raw DICOM downloads (about 2.4 GB) stay in the project folder on the Mac.
- **Image reviews:** `app/api/scan-read` has two AI doctors look at each exam's key images (an imaging specialist and a senior physician, then the senior reviews both) and saves the result in the database (`scan_reads`). Reviews show on each scan page and are given to Ask AI with every question. They are AI observations, not radiology reads.
- **Sharing:** Imran or Salman can pick scans, lab results and visits and make a private link (`/s/<token>`) for doctor friends. The link shows only those records (images, reports, original PDFs, and the AI Doctors' notes if ticked) and works until it is turned off in Shared links. The page template carries no record; `lib/share.js` picks the shared records from `data/share-src.json.enc`, and `/s/<token>/f/...` serves only that link's files.
- **AI Doctors:** every AI answer and review is labelled as coming from the AI Doctors, kept separate from what her real doctors and the official reports say.
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
