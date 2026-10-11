# Nadogradnje i aktivacija

Implementirane su funkcionalne nadogradnje za prioritete 1, 2, 3, 4, 6 i 7 te početni FHIR izvoz za 8. Migracije `202610040001`–`202610040010` i `202610070001` pripadaju jednoj isporuci: novi frontend zahtijeva njihove RPC funkcije. Svih 11 novih migracija primijenjeno je 7. listopada 2026. na konfigurirani Supabase projekt, bez resetiranja baze. API potvrđuje verziju `20261007`; SHA-256 provjera zapisa svih novih migracija odgovara lokalnom SQL-u. Postojeća migracija `202610010002_hospital_waitlist` preuzeta je iz serverske povijesti kako bi repozitorij zadržao stvarno stanje baze. Nova funkcija `notifications-dispatch` također je objavljena. Frontend se objavljuje na povezani Vercel projekt nakon pushanja provjerenog commita.

| Prioritet | Promjena                                                                                                                                                          | Preostali uvjet                                                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | CI za build, jedinice, pravila baze i preglednik; zaseban posao za lokalni Supabase Auth/API/RLS/Edge i prijavljenog pacijenta                                    | Potvrditi prolaz posla `local-backend`; u ovom oblaku Docker vfs i disk onemogućuju cijeli Supabase                                               |
| 2         | Zajednička provjera preklapanja termina ordinacije i bolnice, za pacijenta i liječnikov korisnički račun                                                          | Primijenjeno na konfiguriranu bazu                                                                                                                |
| 3         | Poslužiteljska pretraga i stranice pacijenata, dokumenata, privitaka i lijekova; obavijesti po stranicama; filteri vrste/statusa/datuma/ustanove                  | Filtri ostalih povijesnih modula mogu se dalje proširivati                                                                                        |
| 4         | Tjedno radno vrijeme, odsutnosti i evidencija zamjene; liječnički zadaci; zaštita izmijenjenih modalnih obrazaca pri zatvaranju/Escape/osvježavanju               | Zamjena ne dodjeljuje automatski pristup kartonu niti premješta postojeće termine; cjelovita mobilna provjera svih portala ostaje zaseban korak   |
| 6         | Podsjetnici na termine u portalu, e-mail red dostave s pokušajima i idempotentnošću; potvrda preuzimanja kritičnog nalaza                                         | Portalni podsjetnici imaju aktivan raspored svakih 5 minuta; e-mail čeka verificiranog pošiljatelja i pristanak; SMS/push još nisu implementirani |
| 7         | Pacijentov zahtjev za termin i potvrda ordinacije, provjereni skrbnički pristup maloljetniku, djelomično izdavanje recepata, laboratorijski trendovi iz povijesti | Pravnu osnovu skrbnika provjerava administrator izvan aplikacije; zamjena lijeka nije podržana                                                    |
| 8         | Lokalno preuzimanje osnovnog FHIR R4 Bundle izvoza kartona                                                                                                        | Stvarne integracije, službeni šifrarnici i kvalificirani potpis trebaju cilj, ugovor/specifikaciju i pristup                                      |

## Provjere

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm test
pnpm run test:db
pnpm run test:clinical
pnpm run test:workflows
pnpm run test:laboratory
pnpm run test:priority
pnpm exec playwright install chromium
pnpm run test:e2e
```

PGlite izvršava SQL pravila i migracije, ali ne zamjenjuje provjeru Supabase Auth, PostgREST, Storage i Edge runtimea. Javni E2E testovi ne traže backend. Za integracijsku provjeru koristite **isključivo jednokratni lokalni Supabase** s izmišljenim podacima:

```sh
supabase start -x studio,imgproxy,logflare,vector,supavisor
# U drugom terminalu:
supabase functions serve document-files
# U prvom terminalu (POSIX):
ALLOW_DISPOSABLE_LOCAL_TESTS=true pnpm run test:backend:local
pnpm run test:e2e:live
```

Skripta odbija udaljene URL-ove, stvara izmišljene račune i zadržava podatke u lokalnoj bazi. Automatski izrađena `.env.live-tests` s nasumičnom lozinkom ignorirana je u Gitu. Prijavljeni test ne snima tragove, video ni snimke zaslona. Zaseban CI posao pokreće i zatim zaustavlja lokalni backend; uspjeh tog posla treba potvrditi nakon pushanja promjena. Postojeći `test:files:live` i dalje je dodatna provjera punog privatnog prijenosa datoteka na izričito odobrenom razvojnom projektu.

## Podsjetnici i e-mail

Nova Edge funkcija `notifications-dispatch` provjerava poseban `NOTIFICATIONS_JOB_TOKEN`; ne poziva se iz preglednika. Objavite je na razvojni Supabase i spremite tajne kroz njegovo upravljanje tajnama. JWT gateway provjera je isključena jer funkcija izričito provjerava taj token.

- `NOTIFICATIONS_JOB_TOKEN`: zaseban nasumični token od najmanje 32 bajta.
- Za e-mail: `RESEND_API_KEY`, verificirana adresa `NOTIFICATION_FROM_EMAIL` i HTTPS `APPLICATION_URL` aplikacije.
- `SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` pruža Supabase runtime; service ključ nikad ne pripada frontend VITE varijablama.

Postavite raspored POST poziva svakih pet minuta na `/functions/v1/notifications-dispatch` s `Authorization: Bearer <NOTIFICATIONS_JOB_TOKEN>`. Token čuvajte u tajnama rasporeda/Vaultu. Bez konfiguracije e-maila funkcija generira samo obavijesti portala. Podsjetnici se generiraju za aktivne termine unutar sljedeća 24 sata; ne ponavljaju se za isti termin i vrijeme početka. Pomak termina dobiva novi podsjetnik. Otkazivanje ne briše već dostavljen podsjetnik.

Nakon provjere domene, dostave i rasporeda, pozovite `configure_notification_delivery({enabled:true})` **service-role klijentom** da korisnici mogu uključiti e-mail. Zadano je isključen. Opće obavijesti sadrže poveznicu na portal. Potvrde prioritetnih pregleda dodatno sadrže datum, vrijeme, trajanje, bolnicu, odjel, specijalista i lokaciju; ne uključuju dijagnozu, nalaz ni sadržaj uputnice ili privatne poruke. Dostava zahtijeva potvrđenu adresu, poštuje korisnički pristanak i najviše pet pokušaja. Obrada jednog poziva ograničena je na 20 poruka; nadzirite kapacitet reda prije šire primjene. E-mailovi nisu poslani ovom provjerom; dostava e-maila ostaje isključena do verifikacije pošiljatelja.

## Skrbnici i ljekarna

Administrator sustava u skrbnom timu bira provjereni račun s ulogom pacijenta, pravnu osnovu i referencu provjere. Ovlast je za čitanje kartona, dokumenata i laboratorijskih nalaza maloljetnika. Opoziv, arhiviranje, blokada pristupa, istek i punoljetnost uklanjaju pristup pri sljedećem dohvaćanju. Već preuzete dokumente nije moguće opozvati. Skrbniku se ne prenose ovlasti za terapiju, termine, komunikaciju ili postavke računa djeteta. Administrativna uloga sama po sebi ne otvara klinički karton.

Ljekarnik unosi stvarno izdane cijele količine po stavci, od nule do preostale propisane količine; mora izdati barem jednu stavku. Transakcija zaključava recept i ne dopušta prekomjerno ili dvostruko izdavanje iste operacije. Evidencija preuzimanja je nepromjenjiva. Važeći djelomični recept ostaje `ISSUED`, a u cijelosti izdan postaje `DISPENSED`. Starije potpune realizacije kompatibilne su s novim prikazom.

## Vanjske integracije

FHIR izvoz je datoteka na korisnikovu uređaju, bez slanja vanjskom sustavu. Obuhvaća sadržaj prikazanog kartona (s postojećim ograničenjima povijesti): pacijenta, preglede, vitalne parametre, dijagnoze, alergije i terapiju. Ne uključuje laboratorijske nalaze, izdane dokumente ili privitke. Lokalni demonstracijski kodovi nisu označeni kao službeni ICD/SNOMED. Izvoz ne potvrđuje sukladnost s nacionalnim profilom niti zamjenjuje kvalificirani potpis.

Za konkretnu integraciju potrebno je odabrati sustav (npr. laboratorijski LIS, bolnički HIS ili CEZIH), dobiti specifikaciju i testni pristup te utvrditi dopuštene podatke i vlasništvo službenih šifrarnika. Za kvalificirani potpis trebaju odabrani pružatelj, certifikati i potpisni postupak. Bez tih podataka nije moguće implementirati ili potvrditi stvarnu razmjenu. MFA/sigurnosni prioritet 5 nije uključen u ovu odabranu nadogradnju.

## Stanje 7. listopada 2026.

Dodani su poslužiteljska pretraga i paginacija svih privatnih privitaka, s filtrima vrste i datuma. Prijašnji prikaz od 100 najnovijih datoteka zamijenjen je stranicama od 50. Pretraga ne prikazuje nedovršene prijenose; arhivirani dokumenti pojavljuju se samo kad se uključi taj prikaz. Postojeće ovlasti i audit dohvaćanja ostaju obvezni. Frontend sada traži verziju sheme najmanje `20261007`.

Administratorski tokeni Supabasea i Vercela te Resend ključ postavljeni su kroz sigurne postavke. Upravljački API-ji sada su dostupni. Vrijednosti tajni nisu zapisane u repozitorij. Primjena migracija obavljena je tek nakon usklađivanja prethodne povijesti i prolaza lokalnih provjera.

Za buduće primjene dostupan je `scripts/apply-project-migrations.mjs`: bez argumenata dohvaća samo plan; `--apply` primjenjuje nedostajuće migracije i zapisuje povijest u istoj transakciji. Nepoznate prethodne migracije i rupe u povijesti zaustavljaju primjenu. Node u ovom cloud okruženju koristi `NODE_USE_ENV_PROXY=1`. Tri dodatne provjere `npm run test:migrations` potvrđuju očuvanje izvornog SQL-a u povijesti, rollback neuspjele migracije i obveznu transakciju.

Pri prvoj isporuci e-mail je ostao isključen do provjere domene i adrese pošiljatelja. Resend ključ sam po sebi ne aktivira dostavu. Raspored `ez-notifications-dispatch` aktivan je svakih pet minuta. Zaseban nasumični token pohranjen je u Supabase tajnama i Vaultu; nije u GitHub kodu ili frontend varijablama. Pri toj isporuci raspored je generirao podsjetnike u portalu bez slanja e-mailova. Aktivacija je opisana u nastavku.

## Pretraga laboratorija — 11. listopada 2026.

Pacijent, ordinacija i laboratorij mogu pretraživati cijelu dostupnu povijest laboratorijskih narudžbi po broju, traženim pretragama, imenu ili broju pacijenta, liječniku i laboratoriju. Dodani su kombinirani filtri statusa, hitnosti i datuma naručivanja. Pretraga se pokreće tipkom **Pretraži** ili Enterom; primjena i poništavanje filtara vraćaju prikaz na prvu stranicu. Rezultati dolaze u stranicama od 50 narudžbi. Pretraživanje ne uključuje tekst zaključka ni izmjerene vrijednosti nalaza.

Nova migracija `202610110001_laboratory_search` dodaje `search_laboratory` i indekse povijesti. Datumi obuhvaćaju cijele dane u zoni Europe/Zagreb, uključujući promjenu sata. Jednake vremenske oznake imaju stabilan dodatni poredak po ID-u. Ovlasti, audit pregleda i nepromjenjiva povijest ispravaka ostaju obvezni. Postojeći `list_laboratory` ostaje dostupan starijim klijentima. Novi frontend zahtijeva verziju sheme najmanje `20261011`; migraciju treba primijeniti prije objave frontenda.

`pnpm run test:laboratory` koristi jednokratnu PGlite bazu s izmišljenim podacima za provjeru cijele povijesti, paginacije, kombiniranih filtara, datumskih granica i ovlasti. Pregledničke provjere koriste stvarni laboratorijski prikaz s lažnim odgovorima API-ja, bez stvarnih korisnika i podataka; provjeravaju primjenu/poništavanje filtara, povratak na prvu stranicu i mobilni prikaz.

Migracija je primijenjena 11. listopada na konfigurirani Supabase projekt. SHA-256 zapisa migracije odgovara izvornom SQL-u; javni API potvrđuje verziju `20261011`, a anonimni poziv pretrage odbijen je kodom `42501`. Build i 188 lokalnih provjera prolaze: 11 jedinica, 24 pravila baze, 97 kliničkih provjera, 30 tijekova rada, 12 laboratorijskih provjera i 14 pregledničkih provjera. Prijavljeni tijek na stvarnom Supabaseu nije provjeren ovom isporukom.

## Prioritetni bolnički pregledi — 11. listopada 2026.

Iz otvorenog kartona koristite **Naruči prioritetni pregled**. Bolnica i odjel ograničavaju izbor specijalista. Njegove smjene automatski određuju slobodne datume i vremena u sljedećih 31 dan; početni datum pretrage može se promijeniti. Jutarnja smjena traje 07:00–13:30, poslijepodnevna 13:30–19:00. Trajanje pregleda određuje odjel: 15 ili 30 minuta. Svaki termin mora u cijelosti stati u smjenu. Bez postavljene smjene nema ponuđenih termina.

U **Bolnički odjeli i smjene** administrator bolnice dodaje odjele, određuje trajanje te povezuje postojeće usluge ili dodaje ambulantu specijalista. Prilikom migracije postojeće bolničke usluge povezane su s odjelima prema njihovoj specijalnosti; početno trajanje tih odjela je 30 minuta, a administrator ga može promijeniti. Nisu dodani izmišljeni liječnici ni bolnice. Specijalist uređuje smjene svojih ambulanti; administrator može uređivati ambulante u svojoj ustanovi. Smjene postavljaju i opće radno vrijeme specijalista za taj dan, prema rasponu njegovih aktivnih bolničkih ambulanti. Odsutnosti i zauzeti termini u ordinaciji ili drugoj bolničkoj ambulanti uklanjaju se iz ponude. Promjena rasporeda ili trajanja odjela ne mijenja postojeće potvrđene narudžbe.

Liječnik bilo koje grane može naručiti pacijenta kojem ima aktivnu ovlast liječnika koji ga liječi. Administrativna uloga, medicinska sestra ili sam pacijent ne mogu stvarati prioritetne narudžbe. Pristup blokiran od strane pacijenta uklanja i ovu ovlast.

Potrebna je uputnica za istog pacijenta i istu specijalnost, vrste specijalistički pregled, bolničko liječenje ili kontrola, koja vrijedi na dan pregleda i nije vezana uz drugu neotkazanu narudžbu. Postojeće uputnice mogu se pretraživati po broju i listati po stranicama. Nova uputnica i rezervacija spremaju se u jednoj transakciji: neuspjela rezervacija ne ostavlja uputnicu ni termin. Uputnica je vrste specijalistički pregled, s redovnom hitnošću; bolnička narudžba uvijek nosi zasebnu oznaku PRIORITETNI pregled i razlog prioriteta. Ponovljeni zahtjev s istim sadržajem ne izdaje dodatnu uputnicu ni narudžbu. Unikatni indeks i zaključavanje zajedničkog rasporeda sprječavaju dvostruko zauzimanje termina.

Potvrda je odmah dostupna pacijentu u portalu. E-mail potvrda šalje se kroz postojeći red i raspored dostave ako je usluga aktivna, pacijent ima povezan račun s potvrđenom adresom i uključene e-mail obavijesti. Ekran nakon rezervacije razlikuje red slanja, poslanu potvrdu i nedostajuću konfiguraciju/pristanak/adresu; ne prikazuje neposlanu potvrdu kao poslanu. Otkazivanje ili premještanje poništava zastarjelu potvrdu koja još čeka obradu. Poslana poruka ne može se opozvati. Konfiguracija pošiljatelja i aktivacija dostave dovršene su nadogradnjom opisanom u nastavku.

Migracije `202610110002_priority_hospital_clinics` i `202610110003_hospital_confirmation_email` pripadaju ovoj isporuci. Novi frontend traži reviziju sheme `2026101102`; prije objave primijenite obje migracije i objavite novu verziju funkcije `notifications-dispatch`. Starije ručno objavljene bolničke usluge, termini, narudžbe i povijest ostaju sačuvani.

Obje migracije primijenjene su 11. listopada na konfigurirani Supabase projekt; SHA-256 zapisa odgovara izvornom SQL-u. API potvrđuje reviziju `2026101102`, a anonimni pristup bolničkom kontekstu odbijen je kodom `42501`. Nova verzija `notifications-dispatch` objavljena je bez promjene postojećeg rasporeda i tajnog tokena.

Provjere uključuju 13 novih testova baze za prioritetni postupak, test sadržaja e-mail potvrde i dva preglednička postupka s izmišljenim odgovorima API-ja (postojeća/nova uputnica, promjena bolnice i mobilni prikaz). Lokalni build i ukupno 207 provjera prolaze. PGlite i lažni odgovori preglednika ne zamjenjuju prijavljeni Supabase Auth/API/Edge postupak; stvarni e-mail nije poslan ovom provjerom.


## Automatske e-mail potvrde, promjene i otkazivanja — 11. listopada 2026.

Migracija `202610110004_appointment_email_events` dodaje potvrde za ordinacijske i sve bolničke rezervacije, promjene termina i otkazivanja. Serverska funkcija šalje hrvatski HTML i tekstualnu inačicu preko Resenda, od `e-Zdravstvo <narudzbe@e-zdravstvo.tech>`. Podaci za dolazak ne uključuju dijagnoze, sadržaj uputnice ili razloge prioriteta/otkazivanja. Postojeća prava zakazivanja i pacijentov izbor e-mail obavijesti ostaju na snazi.

Migracija je primijenjena na povezani Supabase projekt, uz potvrdu podudaranja SQL-a sa zapisom migracije. Nova Edge funkcija je objavljena. `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL` i `APPLICATION_URL` postavljeni su samo u serverskim tajnama; URL portala je `https://e-zdravstvo.vercel.app`. Dostava je uključena, a postojeći raspored svakih pet minuta i njegov token sačuvani su. Neautorizirani zahtjev funkciji i anonimni pristup redu odbijeni su statusom 401. Ključ nije pronađen u frontend buildu.

Privatna evidencija čuva svaki završeni pokušaj i istek radne rezervacije, a ponavljanja koriste stabilni Resend ključ idempotencije. Nakon pet pokušaja ili 23 sata od prvog pokušaja poruka ostaje označena kao neuspješna za provjeru. Rezervacije se ne poništavaju pri neuspjeloj dostavi. Nova promjena ili otkazivanje poništava zastarjele poruke koje čekaju obradu; već poslane poruke ne mogu se opozvati.

Prošlo je 17 unit testova, 11 novih provjera e-mail tijeka, 13 prioritetnih bolničkih provjera, 30 provjera postojećih tijekova i 24 provjere baze, uz produkcijski build. HTTP testovi koriste zamjenske odgovore, a SQL testovi izoliranu bazu; stvarna dostava u pacijentov sandučić nije dio tih testova.

Postavljanje varijabli, pregled evidencije i postupak provjere stvarne dostave opisani su u [email-potvrde.md](email-potvrde.md).
