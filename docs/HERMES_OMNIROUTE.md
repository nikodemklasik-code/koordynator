# Hermes Agent + OmniRoute + Koordynator

Koordynator i Hermes są klientami tego samego lokalnego gatewaya OmniRoute.
Hermes nie jest tu serwerem API ani źródłem uniwersalnych darmowych tokenów.
Model, połączenie dostawcy, limit i sposób rozliczenia są odrębnymi ustawieniami.

## 1. Przygotuj połączenia w OmniRoute

Uruchom swoją instalację OmniRoute i otwórz `http://127.0.0.1:20128/home`.
Dodaj/loguj połączenia przez flow dostępny w tej wersji OmniRoute:

| Cel | Połączenie / trasa | Co sprawdzić |
| --- | --- | --- |
| OpenAI przez sesję Codex | Codex, zwykle `cx/…` lub `codex/…` | Konto zalogowane, model dostępny w planie, limit niewyczerpany |
| Anthropic przez sesję Claude Code | Claude Code, zwykle `cc/…` lub `claude-code/…` | Dostęp danej sesji i obsługa tego sposobu logowania przez providera |
| GitHub Copilot | Copilot OAuth, zwykle `gh/…`, `github/…` lub `github-copilot/…` | Aktywna sesja i model dostępny przez Copilot |
| Grok / xAI przez chronioną sesję | Grok CLI lub xAI OAuth, np. `gc/…`, `grok-cli/…`, `xao/…` | Aktywna sesja i faktyczna dostępność modelu |
| Gemini CLI | Gemini CLI OAuth, zwykle `gemini-cli/…` | Aktywna sesja OAuth i limit darmowego/planowego dostępu |
| Kiro / Qoder / Qwen | Chronione OAuth, np. `kr/…`, `if/…`, `qw/…` | Aktywna sesja, quota i model obecny w katalogu |
| Darmowe API | np. Groq / Gemini Free Tier / OpenRouter free | Klucz tego providera, jego model i rzeczywista darmowa kwota |
| Płatne API | np. `openai/…` / `anthropic/…` | Osobny billing; domyślnie blokowany w tym launcherze |

Nie kopiuj klucza OpenRouter do pola klucza OmniRoute. Wygeneruj klucz klienta
w OmniRoute. Sesje OAuth i klucze dostawców pozostają w jego magazynie.
Prefiksy to konwencje adaptera, nie dowód aktywnego abonamentu; rzeczywista
odpowiedź jest sprawdzana osobnym probe. Używaj połączeń udostępnionych dla Twojego
konta, bez odtwarzania cookies lub obchodzenia limitów.

## 2. Konfiguracja repozytorium

Node.js 20.19+; runtime OmniRoute może wymagać nowszego Node.

```bash
npm ci --ignore-scripts
cp .env.example .env
chmod 600 .env
```

Jeśli `.env` już istnieje, edytuj go zamiast kopiować przykład ponownie.
Wprowadź lokalnie:

```dotenv
OMNIROUTE_ENDPOINT=http://127.0.0.1:20128/v1
OMNIROUTE_API_KEY=WPISZ_KLUCZ_GATEWAYA_LOKALNIE
KOORDYNATOR_CHAT_MODEL=WPISZ_DOKLADNA_TRASE_Z_DIAGNOSTYKI
KOORDYNATOR_OPENAI_MODEL=WPISZ_DOKLADNA_TRASE_CODEX
KOORDYNATOR_ANTHROPIC_MODEL=WPISZ_DOKLADNA_TRASE_CLAUDE_CODE
KOORDYNATOR_GITHUB_COPILOT_MODEL=WPISZ_DOKLADNA_TRASE_COPILOT
KOORDYNATOR_GROK_MODEL=WPISZ_DOKLADNA_TRASE_GROK
KOORDYNATOR_GEMINI_MODEL=WPISZ_DOKLADNA_TRASE_GEMINI_CLI
KOORDYNATOR_KIRO_MODEL=WPISZ_DOKLADNA_TRASE_KIRO
KOORDYNATOR_QODER_MODEL=WPISZ_DOKLADNA_TRASE_QODER
KOORDYNATOR_QWEN_MODEL=WPISZ_DOKLADNA_TRASE_QWEN
```

Wartości powyżej są miejscami do uzupełnienia, nie nazwami modeli.
`npm run doctor:omniroute` odczytuje katalog i pokazuje `subscriptionRoutes`
(OpenAI, Anthropic, GitHub Copilot, Grok), `oauthRoutes` (Gemini CLI, Kiro,
Qoder, Qwen) oraz politykę kosztów dla każdego modelu. Raport nadal zostaje
pokazany, jeśli bieżący model nie istnieje lub jest zablokowany (kod wyjścia 1).
Przepisz dokładne identyfikatory z własnego gatewaya do `.env`.
Katalog importowany przez użytkownika 2026-09-10 ma 787 pozycji u 12 providerów;
trzy przesłane kopie są równoważne. Nie zawiera dowodu logowania, salda ani
udanych wywołań i nie jest importowany do repo jako lista działających modeli.

## 3. Uruchamianie

```bash
npm run doctor:omniroute -- --probe
npm start
```

Koordynator otwiera serwer `http://127.0.0.1:8787`.
W drugim terminalu w tym repozytorium:

```bash
npm run hermes
# albo wybrana rodzina modeli, według zmiennych z .env:
npm run hermes:openai
npm run hermes:anthropic
npm run hermes:github
npm run hermes:grok
npm run hermes:gemini
npm run hermes:kiro
npm run hermes:qoder
npm run hermes:qwen
```

Wymagany jest zainstalowany `hermes` w PATH (`hermes --version`). Launcher
sprawdza katalog i istniejącą politykę kosztów, a następnie uruchamia
`hermes chat --provider custom --model <dokładna trasa>`.
Profil `.orchestrator/hermes-omniroute/` zawiera wygenerowany `config.yaml`
z `model.provider=custom`, `model.base_url`, `model.default`,
`model.api_mode=chat_completions` i kluczem związanym z tym endpointem.
Pliki mają uprawnienia 0600, katalog 0700 i są wyłączone z Git.
Nie commituj ani nie udostępniaj tego profilu: zawiera lokalny klucz.
Launcher odtwarza zarządzaną konfigurację z `.env` przy każdym starcie;
nie edytuj jej ręcznie. Sesje zostają w tym profilu.

To usuwa konflikt „model auto/best-free, aktywny Nous Portal, klucz OpenRouter”.
Globalny profil `~/.hermes` i jego sesje/sekrety nie są zmieniane ani kopiowane.
Nie wystarcza samo `OPENAI_BASE_URL`: aktualny Hermes używa również konfiguracji
providera i adresu w `config.yaml`.

Hermes wywołuje OmniRoute bezpośrednio. Kontrola kosztów launchera dotyczy
wyboru początkowego; zmiany modelu, fallbacki i dodatkowe narzędzia w samym
Hermesie podlegają jego ustawieniom oraz gatewayowi. Dla pracy bez dodatkowych
opłat ogranicz połączenie/klucz i combo w OmniRoute do uprawnionych tras.
Nie dodawaj płatnego fallbacku. Nazwa `auto`, `best-free` lub `hermes-free`
sama nie stanowi potwierdzenia zerowej ceny.

## 4. Diagnostyka i granice testu

| Wynik | Znaczenie / działanie |
| --- | --- |
| `OMNIROUTE_API_KEY_REQUIRED` | Uzupełnij klucz klienta gatewaya w `.env` |
| `…AUTH_REQUIRED` / HTTP 401/403 | Gateway odrzuca klucz lub upstream wymaga logowania |
| `…UNAVAILABLE` | Uruchom OmniRoute; sprawdź host, port, sieć |
| `…USE_V1_NOT_HOME` | Podaj API `/v1`, a nie panel `/home` |
| `…MODEL_NOT_IN_CATALOG…` | Wybierz dokładną trasę z doctor |
| `BLOCK_FREE_UNCONFIRMED` / `BLOCK_UNKNOWN` | Brakuje dowodu kosztu; wybierz potwierdzoną darmową lub abonamentową trasę |
| `BLOCK_PAID_API` | Wybrana trasa jest płatna; nie ma automatycznego override |
| HTTP 429 | Limit wyczerpany; poczekaj na reset albo wybierz inne uprawnione połączenie |
| `READY_FOR_PROBE` | Katalog/polityka pozwalają na próbę, ale inference jeszcze niesprawdzone |
| `inference: PASS` | Wykonano jedno wywołanie i odebrano niepusty tekst; tool calling nadal `NOT_TESTED` |

`doctor` bez `--probe` nie generuje tekstu. `--probe` zużywa niewielką część
limitu modelu i nigdy nie wyświetla odpowiedzi upstream ani klucza.
`npm run live:chat` dodatkowo sprawdza streaming i zapis odpowiedzi w Control.

Jeżeli Hermes/Koordynator działa w kontenerze, `127.0.0.1` wskazuje ten
kontener. Dla gatewaya na hoście Docker Desktop użyj osiągalnego adresu hosta,
np. `http://host.docker.internal:20128/v1`, i odpowiednio skonfiguruj nasłuch
gatewaya. W Linuksie potrzebne może być jawne mapowanie `host-gateway`.

## Źródła zgodności

- [Hermes CLI i parser argumentów](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/_parser.py)
- [Hermes: custom endpoint i wybór klucza](https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/runtime_provider_backends.py)
- [OmniRoute v3.8.50](https://github.com/diegosouzapw/OmniRoute/blob/release/v3.8.50/README.md)

Sprawdzono kod aktualnego upstream Hermesa oraz kontrakty Koordynatora.
Lokalna wersja użytkownika i połączenia OAuth wymagają testu na jego komputerze.
