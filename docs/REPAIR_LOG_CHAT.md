# Rejestr napraw czatu (append-only)

## R1 — czat nie miał wykonawcy repozytorium

T0: f83aa4dfe0145feece57d444eb2f97546fd357d0. ChatService.generate wykonywał
wyłącznie POST /chat/completions. GithubRepositoryContextService pobierał kontekst
read-only. T1: dodano kontrolowany wybór /repo, lokalny proces Hermesa, klon i gałąź,
przesyłanie statusu/wyniku istniejącymi zdarzeniami oraz zatrzymanie grupy procesów.
Weryfikacja: typecheck oraz 4 testy routingu, blokady, zapisu odpowiedzi i anulowania PASS.
Niezależność: DYSCYPLINA. Live Hermes/Mac/push: NOT_TESTED.
Werdykt uruchomieniowy całości: NIEZWERYFIKOWANE do próby w środowisku użytkownika.
Higiena A: nowe pliki runner, test, instrukcja i ten rejestr należą do naprawy.
Higiena B: nie usuwano istniejącego WIP ani kodu innych gałęzi.
Higiena C: artefakty npm i build są ignorowane przez git i służą dalszej weryfikacji.
Konfiguracja połączeń AI nie była modyfikowana; profile dla zadań są odrębne.

## R2 — załączniki binarne bez rozpoznawania i ekstrakcji

T0: 34e2362 (po R1). UpstreamMessage wysyłał wszystkie dokumenty jako file_data,
a frontend odrzucał ZIP. T1: ekstrakcja tekstu z PDF/Office/ZIP w workerze, sygnatury
obrazów, jawne statusy, przekazanie załączników wykonawcy poza checkoutem.
Zamknięte: TXT/UTF8, DOCX, XLSX, PPTX, ZIP, tekstowy PDF i rozpoznawanie obrazów.
Nietknięte: trasy modeli i konfiguracja istniejących połączeń.
Ograniczenia: OCR, stare binarne Office i pozostałe formaty bez dekodera; brak live
wywołania providera na Macu. Werdykt: CZĘŚCIOWE względem „każdego formatu”.
Niezależność: DYSCYPLINA. npm run verify: 207 testów w 55 plikach PASS, typecheck,
build, e2e, golden, provider-golden PASS. Test PDF używa rzeczywistego dokumentu PDF.
Higiena A: nowe pliki attachment-extractor, worker, reader i test są częścią naprawy;
package-lock rejestruje zależności. Higiena B: nie usuwano istniejącego WIP.
Higiena C: brak śmieci dodanych do git. Test przeglądarkowy zablokowany przez
środowisko przeglądarki (ERR_BLOCKED_BY_CLIENT); testy HTTP/UI w zestawie PASS.
