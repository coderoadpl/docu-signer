# Handoff: migracja do wyewoluowanego agentproofarch (stan na 2026-07-20)

Notatka dla nowej sesji otwartej w tym repo. Kontekst powstania appki: sesja
w repo bookkeeping (`claude --resume 092cf103-e904-4334-9e6c-51a42316bbc7`, host Mac)
— tam padły wszystkie decyzje produktowe.

## Czym jest ta appka

Archiwum dokumentów firmowych (Amazing Company) dla 2 zaufanych userów (Mateusz,
Weronika): każdy dokument = wpis + załączniki w rolach (`source` czysty PDF /
`signed-scan` / `signed-digital` / `other`). Docelowo paperless: podpis piórkiem
na iPadzie, wzory dokumentów + API do generowania draftów przez agenta AI.

## Stan implementacji

- Faza 0: transplantacja walking skeleton z `agentproofarch/demo` (commit 38e36f8).
- F1 GOTOWE, PR #1 (github.com/chomamateusz/podpisy/pull/1), branch `feat/f1-archive`,
  worktree `~/repositories/podpisy-wt-f1`: model documents+files, StoragePort
  (local-fs + vercel-blob, client upload), UI PL (lista+filtry+zaznaczanie, widok pary
  side-by-side, upload per rola), czysty eksport (PDF bez Info/XMP, bulk ZIP fflate
  z mtime=epoka DOS, cap 100), hardening (bramka membership, disableSignUp, allowlist
  content-type, limity body per-route, cap 25MB), seed: tenant `default` + 2 adminów
  z env (SEED_ADMIN1/2_EMAIL/PASSWORD). 3 przejścia review (Opus) → MERGE-READY.
- Dev lokalny: postgres docker :47542 (kontener `podpisy-db-1`), API :47100,
  web vite :47180; seed wypisuje hasła dev na stdout.

## ZADANIE: pełna migracja do aktualnego agentproofarch

`~/repositories/agentproofarch` wyewoluował od naszej transplantacji (baza:
commit skeletona z ok. 2026-07-17/18). Plan i implementacja pełnej migracji:

1. Zdiffować aktualny `agentproofarch/demo` z naszą bazą (git log/diff w tamtym
   repo od daty transplantacji) — zidentyfikować nowe wzorce, przeniesione pliki,
   zmiany reguł lint/boundaries, nowe porty/konwencje.
2. Zaplanować przeniesienie: co nadpisać 1:1, co scalić (nasze zmiany: single-tenant
   resolution, storage adaptery, documents resource, trusted origin vite, login
   branding PL), co świadomie pominąć.
3. Implementacja na worktree, fazami z zielonym `npm run check` + `npm run smoke`
   po każdej; review przed merge (wzorzec z F1: codex impl → Opus review → fixy).

WARUNEK WSTĘPNY: PR #1 zmergowany do main (migracja na czystym main).

## Otwarte decyzje/następne fazy (po migracji)

- F2: podpis piórkiem (pdf.js render + canvas ink przez Pointer Events + flatten
  pdf-lib client-side; freehand za każdym razem, BEZ zapisanego stampa).
- Metadane: baza = pełna historia; KAŻDE pobranie przez eksporter strippingujący.
  NIGDY certyfikaty/audit-trail w plikach (użytkownik formalizuje umowy wstecz).
- EXIF w obrazach przy eksporcie: NIEROZSTRZYGNIĘTE (rekomendacja: strippować —
  GPS/model telefonu w skanach-zdjęciach).
- F3: wzory HTML+placeholdery (migracja z tools/uod-generator w bookkeeping),
  API key dla agentów, drafty edytowalne (pola + tabele z edycją wierszy,
  re-render z wzoru), historia wersji w DB, render PDF chromium serverless.
- F4 (opcjonalnie): skaner in-app (jscanify); na razie skan przez natywne
  Notatki/Pliki iOS + upload.
- Deploy: Vercel + Neon + Blob — jeszcze nie robiony; wymaga kliknięć użytkownika.
- Follow-upy z review F1: parytet limitu body na trasach auth, streaming bulk ZIP
  (zamiast materializacji w pamięci), ewentualny ratchet coverage.

## Znane blokery infrastrukturalne

- `gh` (konto `chomamateusz-agent`) dostaje 404 na tym repo — agent NIE jest
  kolaboratorem. PR #1 zmergowano lokalnie przez git/SSH (merge commit 32591db
  na main). Przed operacjami PR w nowej sesji: właściciel dodaje
  `chomamateusz-agent` (Write) na https://github.com/chomamateusz/podpisy/settings/access
  — albo dalej mergujemy lokalnie po SSH.

## Zasady pracy (przeniesione z sesji-matki)

- Implementacja przez Workflow + codex (gpt-5.5) na worktree, review Opus,
  fallback opus przy awarii codexa; NIGDY bez niezależnej weryfikacji `check`.
- Zero komentarzy w kodzie poza nieoczywistym WHY; pass komentarzowy na każdym diffie.
- Commity po angielsku; UI po polsku; nic nie mergować/wysyłać bez zgody użytkownika.
