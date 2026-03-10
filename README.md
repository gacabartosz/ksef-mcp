# ksef-mcp

[![npm](https://img.shields.io/npm/v/ksef-mcp)](https://www.npmjs.com/package/ksef-mcp)
[![license](https://img.shields.io/npm/l/ksef-mcp)](https://github.com/gacabartosz/ksef-mcp/blob/main/LICENSE)
[![KSeF](https://img.shields.io/badge/KSeF-FA(3)-blue)](https://ksef.mf.gov.pl)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io)

**Pierwszy publiczny MCP server do Krajowego Systemu e-Faktur (KSeF) — API v2.**

Uwierzytelnianie (JWT), wystawianie, walidacja i pobieranie e-faktur przez AI. Kompatybilny z **Claude Desktop**, **Claude Code** i **ChatGPT**.

> **KSeF API v2** (2026) — nowe endpointy, JWT Bearer auth, osobne sesje online/batch.
> Dokumentacja API: [api.ksef.mf.gov.pl/docs/v2](https://api.ksef.mf.gov.pl/docs/v2/index.html) |
> Dokumentacja integracji: [github.com/CIRFMF/ksef-docs](https://github.com/CIRFMF/ksef-docs)

---

## Funkcje

### Narzedzia (30 toolow)

| Narzedzie | Opis | Sprint | Typ |
|-----------|------|--------|-----|
| `ksef_env_info` | Srodowisko, NIP, status sesji | 1 | odczyt |
| `ksef_auth_init` | Rozpocznij sesje KSeF (token) | 1 | akcja |
| `ksef_auth_status` | Status aktywnej sesji | 1 | odczyt |
| `ksef_auth_terminate` | Zakoncz sesje | 1 | akcja |
| `ksef_invoices_query` | Wyszukaj faktury po datach | 1 | odczyt |
| `ksef_invoice_get` | Pobierz metadane faktury | 1 | odczyt |
| `ksef_invoice_status` | Status przetwarzania faktury | 1 | odczyt |
| `ksef_invoice_xml` | Pobierz XML faktury FA(3) | 1 | odczyt |
| `ksef_upo_download` | Pobierz UPO sesji | 1 | odczyt |
| `ksef_draft_create` | Utworz szkic faktury | 2 | akcja |
| `ksef_draft_get` | Pobierz szkic faktury | 2 | odczyt |
| `ksef_draft_list` | Lista szkicow | 2 | odczyt |
| `ksef_draft_update` | Aktualizuj szkic | 2 | akcja |
| `ksef_draft_delete` | Usun szkic | 2 | akcja |
| `ksef_draft_validate` | Waliduj szkic wg FA(3) | 2 | odczyt |
| `ksef_draft_render_xml` | Podglad XML faktury | 2 | odczyt |
| `ksef_draft_lock` | Zablokuj draft do wysylki | 3 | akcja |
| `ksef_approval_request` | Zadanie zatwierdzenia | 3 | akcja |
| `ksef_approval_confirm` | Potwierdz zatwierdzenie | 3 | akcja |
| `ksef_send_invoice` | Wyslij fakture do KSeF | 3 | akcja |
| `ksef_audit_log` | Log audytowy operacji | 3 | odczyt |
| `ksef_correction_create` | Utworz korekte faktury | 4 | akcja |
| `ksef_batch_open` | Otworz sesje batch | 4 | akcja |
| `ksef_batch_send_part` | Wyslij czesc batch (ZIP) | 4 | akcja |
| `ksef_batch_close` | Zamknij sesje batch | 4 | akcja |
| `ksef_batch_status` | Status przetwarzania batch | 4 | odczyt |
| `ksef_token_generate` | Wygeneruj nowy token KSeF | 4 | akcja |
| `ksef_token_list` | Lista tokenow (metadata) | 4 | odczyt |
| `ksef_token_get` | Szczegoly tokena | 4 | odczyt |
| `ksef_token_revoke` | Uniewnij token | 4 | akcja |

---

## Instalacja

### Z repozytorium (development)

```bash
git clone https://github.com/gacabartosz/ksef-mcp.git
cd ksef-mcp
npm install
npm run build
```

### Z npm (po publikacji)

```bash
npm install -g ksef-mcp
```

---

## Konfiguracja

Skopiuj `.env.example` do `.env` i uzupelnij:

```bash
cp .env.example .env
```

### Zmienne srodowiskowe

| Zmienna | Opis | Wymagana | Domyslnie |
|---------|------|----------|-----------|
| `KSEF_ENV` | Srodowisko: `test` / `demo` / `prod` | Nie | `test` |
| `KSEF_NIP` | NIP podmiotu (10 cyfr) | Tak | - |
| `KSEF_TOKEN` | Token autoryzacyjny KSeF | Tak | - |
| `KSEF_KEY_PATH` | Sciezka do klucza prywatnego RSA | Nie | - |
| `KSEF_CERT_PATH` | Sciezka do certyfikatu | Nie | - |
| `KSEF_APPROVAL_MODE` | Tryb zatwierdzania: `auto` / `manual` | Nie | `manual` |
| `KSEF_DATA_DIR` | Katalog danych (drafty, sesja, audit) | Nie | `~/.ksef-mcp` |
| `KSEF_LOG_LEVEL` | Poziom logow: `debug` / `info` / `warn` / `error` | Nie | `info` |
| `KSEF_RATE_LIMIT_PER_SECOND` | Limit zapytan na sekunde | Nie | `5` |
| `KSEF_RATE_LIMIT_PER_MINUTE` | Limit zapytan na minute | Nie | `200` |
| `KSEF_RATE_LIMIT_PER_HOUR` | Limit zapytan na godzine | Nie | `1000` |

---

## Token KSeF — jak uzyskac

> **To jest najwazniejsza sekcja jesli chcesz przetestowac integracje z KSeF.**

### Srodowiska KSeF 2.0

| Srodowisko | Portal | API docs |
|------------|--------|----------|
| **TEST** | [ksef.mf.gov.pl](https://ksef.mf.gov.pl) | [api-test.ksef.mf.gov.pl/docs/v2](https://api-test.ksef.mf.gov.pl/docs/v2) |
| **DEMO** | [ksef.mf.gov.pl](https://ksef.mf.gov.pl) | [api-demo.ksef.mf.gov.pl/docs/v2](https://api-demo.ksef.mf.gov.pl/docs/v2) |
| **PROD** | [ksef.mf.gov.pl](https://ksef.mf.gov.pl) | [api.ksef.mf.gov.pl/docs/v2](https://api.ksef.mf.gov.pl/docs/v2) |

### Jak uzyskac token KSeF

Tokeny KSeF generujesz przez API po uwierzytelnieniu podpisem elektronicznym (XAdES).
Pelna dokumentacja: [Zarzadzanie tokenami KSeF](https://github.com/CIRFMF/ksef-docs/blob/main/tokeny-ksef.md)

1. **Uwierzytelnij sie** podpisem elektronicznym (XAdES) — certyfikat kwalifikowany lub pieczec kwalifikowana
   - Dokumentacja uwierzytelniania: [uwierzytelnianie.md](https://github.com/CIRFMF/ksef-docs/blob/main/uwierzytelnianie.md)
2. **Wygeneruj token** przez API:
   - Wywolaj `POST /tokens` z uprawnieniami i opisem
   - Dostepne uprawnienia: `InvoiceRead`, `InvoiceWrite`, `CredentialsRead`, `CredentialsManage`, `SubunitManage`, `EnforcementOperations`, `Introspection`
3. **Zapisz token bezpiecznie** — token jest tajny, wyswietlany tylko raz
4. **Wklej token** do zmiennej `KSEF_TOKEN` w konfiguracji MCP

### Przeplyw uwierzytelniania (API v2)

```
1. POST /auth/challenge              → { challenge, timestamp, timestampMs }
2. POST /auth/ksef-token             → zaszyfruj token|timestampMs kluczem RSA-OAEP
                                       → { authenticationToken (JWT), referenceNumber }
3. GET  /auth/{referenceNumber}      → sprawdz status (polling)
4. POST /auth/token/redeem           → Bearer: authToken → { accessToken, refreshToken }
5. Uzyj: Authorization: Bearer {accessToken} do wszystkich wywolan API
6. POST /auth/token/refresh          → Bearer: refreshToken → nowy accessToken
```

Szczegoly: [Proces uwierzytelniania KSeF 2.0](https://github.com/CIRFMF/ksef-docs/blob/main/uwierzytelnianie.md)

### Przyklad konfiguracji

```bash
KSEF_ENV=test
KSEF_NIP=5993112591
KSEF_TOKEN=twoj-wygenerowany-token-ksef
```

### Wazne uwagi

- **Wymagany polski IP** — srodowiska KSeF sa chronione przez WAF i wymagaja polskiego adresu IP
- **Dane testowe** — w srodowisku testowym mozesz swobodnie wysylac i pobierac faktury
- **Certyfikaty testowe** — do podpisywania w srodowisku testowym mozna uzyc certyfikatow testowych
- **Klucze publiczne MF** — pobierane automatycznie z `GET /security/public-key-certificates`

### Praca bez dostepu do KSeF (tryb offline)

Wiele narzedzi dziala **bez polaczenia z API KSeF**:

| Narzedzie | Wymaga KSeF? | Opis |
|-----------|-------------|------|
| `ksef_draft_create` | Nie | Tworzenie szkicow faktur |
| `ksef_draft_validate` | Nie | Walidacja wg regul FA(3) |
| `ksef_draft_render_xml` | Nie | Podglad XML |
| `ksef_draft_get/list/update/delete` | Nie | Zarzadzanie szkicami |
| `ksef_correction_create` | Nie | Tworzenie korekty (klonowanie lokalne) |
| `ksef_env_info` | Nie | Informacje o konfiguracji |
| `ksef_audit_log` | Nie | Odczyt lokalnego logu audytowego |
| `ksef_auth_init` | **Tak** | Wymaga polaczenia z KSeF |
| `ksef_send_invoice` | **Tak** | Wymaga aktywnej sesji |
| `ksef_invoices_query` | **Tak** | Wymaga aktywnej sesji |
| `ksef_batch_*` | **Tak** | Wymaga aktywnej sesji |
| `ksef_token_*` | **Tak** | Wymaga aktywnej sesji |

Mozesz wiec tworzyc, walidowac i przegladac faktury bez tokena i dostepu do API.

---

## Uzycie z Claude Desktop

Dodaj do `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) lub `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "ksef": {
      "command": "node",
      "args": ["/sciezka/do/ksef-mcp/dist/index.js"],
      "env": {
        "KSEF_ENV": "test",
        "KSEF_NIP": "0000000001",
        "KSEF_TOKEN": "twoj-token-ksef"
      }
    }
  }
}
```

Po zapisaniu pliku zrestartuj Claude Desktop. Narzedzia KSeF pojawia sie w panelu bocznym.

---

## Uzycie z Claude Code

Dodaj do `~/.claude.json` (scope: user):

```json
{
  "mcpServers": {
    "ksef": {
      "command": "node",
      "args": ["/sciezka/do/ksef-mcp/dist/index.js"],
      "env": {
        "KSEF_ENV": "test",
        "KSEF_NIP": "0000000001",
        "KSEF_TOKEN": "twoj-token-ksef"
      }
    }
  }
}
```

Lub w `.mcp.json` w katalogu projektu (scope: project):

```json
{
  "mcpServers": {
    "ksef": {
      "command": "node",
      "args": ["/sciezka/do/ksef-mcp/dist/index.js"],
      "env": {
        "KSEF_ENV": "test",
        "KSEF_NIP": "0000000001",
        "KSEF_TOKEN": "twoj-token-ksef"
      }
    }
  }
}
```

---

## Uzycie z claude.ai (Remote Connector)

ksef-mcp mozna podlaczyc jako remote MCP connector w claude.ai:

1. Wejdz na [claude.ai](https://claude.ai) → Settings → Connectors → **Add custom connector**
2. Wpisz:
   - **Name:** `KSeF`
   - **Remote MCP server URL:** `https://bartoszgaca.pl/ksef/mcp`
3. Kliknij **Add**

Serwer odpowiada na Streamable HTTP transport (POST/GET/DELETE na `/mcp`).

> **Uwaga:** Tokeny KSeF sa przechowywane server-side — claude.ai nie ma dostepu do sekretow.

### Self-hosting HTTP transport

Mozesz postawic wlasna instancje:

```bash
git clone https://github.com/gacabartosz/ksef-mcp.git
cd ksef-mcp && npm install && npm run build

# Uruchom HTTP server
MCP_PORT=3400 KSEF_ENV=test node dist/http.js
```

Nginx reverse proxy:

```nginx
location /ksef/ {
    proxy_pass http://127.0.0.1:3400/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
}
```

---

## Przeplyw wysylki faktury

Pelny przeplyw od szkicu do wysylki:

```
1. ksef_auth_init        → Uwierzytelnij (challenge → ksef-token → redeem → JWT)
2. ksef_draft_create     → Utworz szkic faktury
3. ksef_draft_validate   → Zwaliduj wg regul FA(3)
4. ksef_draft_lock       → Zablokuj i oblicz hash XML
5. ksef_approval_request → Zadaj zatwierdzenia
6. ksef_approval_confirm → Potwierdz (lub auto jesli KSEF_APPROVAL_MODE=auto)
7. ksef_send_invoice     → Auto-otwiera sesje online, szyfruje AES-256-CBC, wysyla
8. ksef_invoice_status   → Sprawdz status przetwarzania (sessionRef + invoiceRef)
9. ksef_audit_log        → Przejrzyj log audytowy
```

### Przeplyw korekty faktury

```
1. ksef_correction_create → Sklonuj wyslana fakture jako korekte (z powodem)
2. ksef_draft_update      → Zmodyfikuj pozycje korekty
3. (dalej standardowy przeplyw: validate → lock → approval → send)
```

### Przeplyw batch (wysylka zbiorcza, API v2)

```
1. ksef_batch_open        → Otworz sesje batch (podaj file hash + parts) → pre-signed URLs
2. ksef_batch_send_part   → Upload czesci na pre-signed URLs
3. ksef_batch_close       → Zamknij sesje batch
4. ksef_batch_status      → Sprawdz status przetwarzania (GET /sessions/{ref})
```

### Tryb automatycznego zatwierdzania

Ustaw `KSEF_APPROVAL_MODE=auto` aby pominac reczne zatwierdzanie. W tym trybie `ksef_approval_request` automatycznie potwierdza approval.

> **Uwaga:** Tryb automatyczny jest wygodny do testow, ale w produkcji zalecany jest tryb `manual` dla pelnej kontroli.

---

## Testowanie narzedzi (stdio)

Mozesz testowac narzedzia bezposrednio przez stdin/stdout:

### Lista narzedzi

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  KSEF_NIP=0000000001 node dist/index.js 2>/dev/null | jq .
```

### Informacje o srodowisku

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ksef_env_info","arguments":{}}}' | \
  KSEF_NIP=0000000001 KSEF_ENV=test node dist/index.js 2>/dev/null | jq .
```

### Utworzenie szkicu faktury

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ksef_draft_create","arguments":{"sellerNip":"0000000001","sellerName":"Firma Test Sp. z o.o.","sellerAddress":"ul. Testowa 1, 00-001 Warszawa","buyerNip":"9999999999","buyerName":"Klient Test S.A.","buyerAddress":"ul. Przykladowa 10, 00-002 Krakow","invoiceNumber":"FV/2026/001","issueDate":"2026-03-08","sellDate":"2026-03-08","currency":"PLN","items":[{"name":"Usluga programistyczna","quantity":1,"unitPrice":10000,"vatRate":23,"unit":"szt"}]}}}' | \
  KSEF_NIP=0000000001 node dist/index.js 2>/dev/null | jq .
```

### Walidacja szkicu

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ksef_draft_validate","arguments":{"id":"ID-DRAFTU-Z-KROKU-WYZEJ"}}}' | \
  KSEF_NIP=0000000001 node dist/index.js 2>/dev/null | jq .
```

---

## Rate limiting

Wbudowany rate limiter chroni przed przekroczeniem limitow API KSeF:

- **5 zapytan/sekunde** (domyslnie)
- **200 zapytan/minute** (domyslnie)
- **1000 zapytan/godzine** (domyslnie)

Limity mozna dostosowac zmiennymi srodowiskowymi:

```bash
KSEF_RATE_LIMIT_PER_SECOND=10
KSEF_RATE_LIMIT_PER_MINUTE=300
KSEF_RATE_LIMIT_PER_HOUR=2000
```

Dodatkowo:
- Odpowiedz **429 (Too Many Requests)** — automatyczne odczekanie wg naglowka `Retry-After` i ponowienie
- Bledy **500/502/503** — automatyczne ponowienie z exponential backoff (max 3 proby)
- Bledy **400/401/403/440** — brak ponowien (bledy klienta)

---

## Bezpieczenstwo

- **Tokeny i klucze** nigdy nie sa przekazywane do modelu AI — pozostaja w srodowisku serwera MCP
- **NIP-y** sa maskowane w logach (`123***90`)
- **NIP-y w audit logu** sa hashowane SHA-256
- **Wszystkie logi** ida na stderr (stdout zarezerwowany dla protokolu MCP)
- **Sesja** zapisywana z uprawnieniami `0600`
- **Dwufazowa wysylka** — faktura musi byc zwalidowana, zablokowana i zatwierdzona przed wyslaniem
- **Hash XML** — weryfikowany na kazdym etapie (lock → approval → send)
- **Approval TTL** — zatwierdzenie wygasa po 15 minutach
- **Audit trail** — kazda operacja jest logowana w formacie JSONL

---

## Srodowiska KSeF API v2

| Srodowisko | URL API | Dokumentacja | Zastosowanie |
|------------|---------|-------------|-------------|
| `test` | `https://api-test.ksef.mf.gov.pl/v2` | [docs](https://api-test.ksef.mf.gov.pl/docs/v2) | Testy integracyjne |
| `demo` | `https://api-demo.ksef.mf.gov.pl/v2` | [docs](https://api-demo.ksef.mf.gov.pl/docs/v2) | Przedprodukcyjne |
| `prod` | `https://api.ksef.mf.gov.pl/v2` | [docs](https://api.ksef.mf.gov.pl/docs/v2) | Produkcja |

Portal: [ksef.mf.gov.pl](https://ksef.mf.gov.pl)

---

## Roadmap

- [x] Sprint 1: Uwierzytelnianie + odczyt faktur (auth, query, session)
- [x] Sprint 2: Kryptografia + szkice faktur + walidacja FA(3)
- [x] Sprint 3: Dwufazowa wysylka + audit trail
- [x] Sprint 4: Korekty + batch + zarzadzanie tokenami
- [x] Sprint 5: Rate limiting + dokumentacja + token testowy
- [x] Sprint 6: **Migracja na KSeF API v2** — nowe endpointy, JWT auth, sesje online/batch

---

## Architektura

```
src/
  index.ts                  — Punkt wejscia MCP (Server + StdioTransport)
  mcp/
    registry.ts             — Rejestr narzedzi (registerTool, collectAll, dispatch)
    auth-tools.ts           — Narzedzia auth (4)
    query-tools.ts          — Narzedzia query (5)
    draft-tools.ts          — Narzedzia draft (7)
    send-tools.ts           — Narzedzia send (5)
    correction-tools.ts     — Narzedzia korekt (1)
    batch-tools.ts          — Narzedzia batch (4)
    token-tools.ts          — Narzedzia tokenow (4)
  domain/
    draft.ts                — CRUD szkicow, obliczanie sum (+ pola korekcyjne)
    validator.ts            — Walidacja FA(3): NIP, daty, stawki VAT, sumy
    xml-builder.ts          — Generator XML FA(3) (fast-xml-parser)
    approval.ts             — Dwufazowe zatwierdzanie (TTL 15min)
    audit.ts                — Append-only JSONL audit log
    correction.ts           — Faktury korygujace (klonowanie wyslanej faktury)
  infra/ksef/
    client.ts               — HTTP client (fetch + rate limit + retry + backoff)
    auth.ts                 — Auth v2 (challenge → ksef-token → redeem → JWT + refresh)
    crypto.ts               — RSA-OAEP, AES-256-CBC, SHA-256, public key certs
    session.ts              — Sesja online (open, send encrypted, close, status, UPO)
    batch.ts                — Sesja batch (open → pre-signed URLs, upload, close, status)
    token-client.ts         — Zarzadzanie tokenami KSeF (POST/GET/DELETE /tokens)
    rate-limiter.ts         — Token-bucket rate limiter
  utils/
    config.ts               — Zmienne srodowiskowe, URL-e, katalogi
    logger.ts               — Logi JSON na stderr z maskowaniem sekretow
    errors.ts               — toolResult/toolError, KsefApiError
```

---

## Licencja

MIT -- zobacz [LICENSE](LICENSE)

## Autor

**Bartosz Gaca** — [bartoszgaca.pl](https://bartoszgaca.pl) | [GitHub](https://github.com/gacabartosz)
