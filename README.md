# ksef-mcp

MCP server dla **Krajowego Systemu e-Faktur (KSeF)** — uwierzytelnianie, wystawianie i pobieranie e-faktur przez AI.

Pierwszy publiczny MCP server do KSeF API na świecie. Kompatybilny z **Claude Desktop**, **Claude Code** i **ChatGPT**.

## Funkcje

| Narzędzie | Opis | Typ |
|-----------|------|-----|
| `ksef_env_info` | Środowisko, NIP, status sesji | odczyt |
| `ksef_auth_init` | Rozpocznij sesję KSeF (token) | akcja |
| `ksef_auth_status` | Status aktywnej sesji | odczyt |
| `ksef_auth_terminate` | Zakończ sesję | akcja |
| `ksef_invoices_query` | Wyszukaj faktury po datach | odczyt |
| `ksef_invoice_get` | Pobierz metadane faktury | odczyt |
| `ksef_invoice_status` | Status przetwarzania faktury | odczyt |
| `ksef_invoice_xml` | Pobierz XML faktury (FA(3)) | odczyt |
| `ksef_upo_download` | Pobierz UPO sesji | odczyt |

## Instalacja

```bash
git clone https://github.com/gacabartosz/ksef-mcp.git
cd ksef-mcp
npm install
npm run build
```

## Konfiguracja

Skopiuj `.env.example` do `.env` i uzupełnij:

```bash
cp .env.example .env
```

| Zmienna | Opis | Wymagana |
|---------|------|----------|
| `KSEF_ENV` | Środowisko: `test` / `demo` / `prod` | Nie (domyślnie: `test`) |
| `KSEF_NIP` | NIP podmiotu (10 cyfr) | Tak |
| `KSEF_TOKEN` | Token autoryzacyjny KSeF | Tak |
| `KSEF_DATA_DIR` | Katalog danych | Nie (domyślnie: `~/.ksef-mcp`) |
| `KSEF_LOG_LEVEL` | Poziom logów | Nie (domyślnie: `info`) |

## Użycie z Claude Desktop

Dodaj do `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ksef": {
      "command": "node",
      "args": ["/ścieżka/do/ksef-mcp/dist/index.js"],
      "env": {
        "KSEF_ENV": "test",
        "KSEF_NIP": "0000000001",
        "KSEF_TOKEN": "twoj-token-ksef"
      }
    }
  }
}
```

## Użycie z Claude Code

Dodaj do `~/.claude.json` (scope: user):

```json
{
  "mcpServers": {
    "ksef": {
      "command": "node",
      "args": ["/ścieżka/do/ksef-mcp/dist/index.js"],
      "env": {
        "KSEF_ENV": "test",
        "KSEF_NIP": "0000000001",
        "KSEF_TOKEN": "twoj-token-ksef"
      }
    }
  }
}
```

## Środowiska KSeF

| Środowisko | URL API | Zastosowanie |
|------------|---------|-------------|
| `test` | `https://ksef-test.mf.gov.pl/api` | Testy integracyjne |
| `demo` | `https://ksef-demo.mf.gov.pl/api` | Przedprodukcyjne |
| `prod` | `https://ksef.mf.gov.pl/api` | Produkcja |

## Bezpieczeństwo

- Tokeny i klucze **nigdy** nie są przekazywane do modelu AI
- NIP-y są maskowane w logach (`123***90`)
- Wszystkie logi idą na stderr (stdout zarezerwowany dla MCP)
- Sesja zapisywana z uprawnieniami `0600`
- Wysyłka faktur wymaga jawnego zatwierdzenia użytkownika (planowane w Sprint 3)

## Roadmap

- [x] Sprint 1: Auth + odczyt faktur
- [ ] Sprint 2: Kryptografia + szkice faktur + walidacja FA(3)
- [ ] Sprint 3: Dwufazowa wysyłka + audit trail
- [ ] Sprint 4: Korekty + batch + zarządzanie tokenami
- [ ] Sprint 5: Rate limiting + HTTP transport + npm publish

## Licencja

MIT

## Autor

Bartosz Gaca — [bartoszgaca.pl](https://bartoszgaca.pl)
