# Praca z repozytorium w czacie

Uruchom po jednorazowym `gh auth login --hostname github.com --git-protocol https --web`
i `gh auth setup-git --hostname github.com`:

```sh
npm run build
KOORDYNATOR_CHAT_REPO_EXECUTION=1 npm run control
```

W czacie wybierz działający model OmniRoute i wpisz:

```text
/repo https://github.com/OWNER/REPO Opisz zadanie do wykonania.
```

Serwer uruchamia lokalnego Hermesa z `git` i `gh` tego samego użytkownika.
Każda wiadomość /repo tworzy osobny katalog w katalogu stanu `repository-jobs`,
klon repo i gałąź `koordynator/task-UUID`. Zwykłe wiadomości nadal używają czatu AI.
Polecenie wymaga linku i zadania; sam link nie uruchamia wykonawcy.
Hermes otrzymuje polecenie przeczytania instrukcji repo, wykonania zadania,
testowania i — dla zmian implementacyjnych — utworzenia draft PR.
Czat pokazuje przygotowanie zadania i końcowy raport. Stop kończy grupę procesów;
limit zadania wynosi 30 minut. Katalog pozostaje do przeglądu lub odzyskania pracy.
Nie ma automatycznego wznowienia poprzedniego zadania ani rollbacku zmian już wysłanych.

To wykonawca lokalny z uprawnieniami użytkownika, nie sandbox. Osobny katalog chroni
bieżący checkout przed kolizjami, nie izoluje systemu. Instrukcje dla agenta o zakazie
merge nie stanowią technicznego ograniczenia uprawnień GitHub. Istniejące zabezpieczenia
HTTP, kontrola modeli i polityka billingowa pozostają przed uruchomieniem wykonawcy.
Zadania niedające się wykonać bez interaktywnej zgody powinny zakończyć się BLOCKED;
most nie włącza automatycznego zatwierdzania narzędzi.

Raport procesu nie jest niezależnym dowodem przejścia testów. Liczba tokenów i koszt
wewnętrznych wywołań Hermesa nie są raportowane przez most; brak telemetrii nie oznacza zera.
Połączenia lokalnego Maca i rzeczywisty push wymagają testu w środowisku użytkownika.

## Załączniki

Przycisk + przyjmuje pliki niezależnie od rozszerzenia. Rozpoznawanie zawartości działa
po stronie serwera: TXT/UTF-8, JSON/CSV/kod, PDF z tekstem, DOCX, XLSX, PPTX, ZIP oraz
sygnatury PNG/JPEG/GIF/WebP. Nazwa `plik.pdf` nie dowodzi, że plik jest PDF-em.
Tekst dokumentów trafia jako tekst do modelu, obrazy jako części image_url.
Załączniki /repo są udostępniane Hermesowi poza checkoutem razem z odczytanym tekstem.

Limity: 5 plików, 10 MB na plik, 20 MB łącznie; 48 tys. znaków tekstu na plik
(z jawnym znacznikiem skrócenia); PDF maks. 100 stron. ZIP: do 300 wpisów,
20 MB rozpakowanych danych, maks. 2 poziomy archiwum, bez zapisu wpisów na dysk
ani wykonywania zawartego kodu. Parser działa w workerze z limitem czasu 20 sekund.
W XLSX odczytywane są adresy komórek, wartości zapisane i formuły; formuły nie są przeliczane.
DOCX/PPTX: odczyt tekstu, nie wierna rekonstrukcja układu, komentarzy ani wszystkich obiektów.

Skan PDF wymaga OCR, którego ten importer nie wykonuje. Obrazy wymagają modelu
obsługującego obrazy. Obrazy wewnątrz ZIP są wymienione, ale nie przesyłane do vision.
Stare binarne DOC/XLS/PPT, RAR/7z, pliki zaszyfrowane, audio/video i nieznane formaty
nie są automatycznie dekodowane. Czat jawnie oznacza brak odczytu; nie gwarantuje
obsługi każdego istniejącego formatu. Oryginały pozostają w historii sesji.

Instalacja zależności: `npm ci`, następnie `npm run build` (worker wymaga skompilowanego pliku).
