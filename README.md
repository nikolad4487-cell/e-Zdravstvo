# e-Zdravstvo

Integrirani digitalni zdravstveni sustav — **faze 1–5**. Originalna razvojna aplikacija, nije povezana s CEZIH-om, HZZO-om, e-Građanima ni drugim službenim sustavima. Isključivo izmišljeni testni podaci; nije spremna za stvarnu medicinsku dokumentaciju.

## Što je implementirano

- React 19, Vite, TypeScript strict, React Router, Tailwind CSS i Lucide.
- Responsive prijava, izbor konteksta djelatnik/građanin, prikaz lozinke, opcija pamćenja sesije, obnova lozinke i odjava.
- Prava Supabase Authentication prijava **e-mailom**; korisnička imena još nisu uvedena. Izbor konteksta na prijavi ne mijenja ovlasti.
- Osam uloga, više uloga po korisniku, preusmjeravanje i zaštićeni portali. Višestruke uloge omogućuju promjenu portala u sidebaru.
- Odvojeni radni prostori liječnika, pacijenta, ustanove, škole i administratora. Kliničke podatke dohvaćaju iz Supabasea.
- SQL migracije: `profiles`, `institutions`, `institution_departments`, `institution_users`, `user_roles`, `audit_logs`, UUID, FK, indeksi, constraints, RLS, updated_at i audit triggeri.
- Kontrolirane SQL funkcije za ustanove, članstva, dodjelu i opoziv uloga. Administratorski UI za te radnje dolazi u fazi 7.
- Privatni Supabase Storage i Edge funkcija za upload/preuzimanje privitaka, s provjerom ovlasti i auditom svake autorizirane operacije.
- Pretraga pacijenata po imenu, ID-u i datumu rođenja, kreiranje pacijenta, karton, alergije i upozorenja. Globalna pretraga Ctrl+K.
- Ustanove: uređivanje osnovnih podataka, dodavanje odjela, prikaz djelatnika i liječnički profili.
- Pregledi s vitalnim parametrima i izračunom BMI-ja, primarna/sekundarne dijagnoze, trajne dijagnoze i terapija. Ispravak pregleda stvara novu verziju i zadržava original.
- Recepti s više stavki, uputnice i ispričnice: potvrda prije izdavanja, jedinstveni brojevi, idempotentno izdavanje, opoziv i automatski status isteka.
- PDF izvoz s ugrađenim fontom za hrvatska slova, QR kodom i demonstracijskim SHA-256 potpisom sadržaja. Potpis nije kvalificiran; hash je kanonskog JSON sadržaja, ne PDF datoteke.
- Osnovni Moje e-Zdravstvo: vlastiti dokumenti, karton, terapija i obavijesti. Supabase Realtime osvježava dokumente nakon obavijesti.
- Javna ruta /verify/:token prikazuje samo metapodatke valjanosti. Škola može provjeriti broj ispričnice ili učitati/fotografirati QR kod, bez pristupa kartonu.
- Central ima paginiranu evidenciju audit događaja bez medicinskog sadržaja.
- Idempotentni seed: 3 liječnika, 2 sestre, 10 izmišljenih pacijenata, pregledi, dijagnoze, terapije, recepti, uputnice i 2 ispričnice.

## Pokretanje

Potrebni su Node.js 22.12+ ili 24+, npm ili pnpm. Za lokalni backend potrebni su Docker Desktop i Supabase CLI.

```sh
npm install
cp .env.example .env
supabase start
supabase db reset
supabase status
```

U `.env` upišite lokalni API URL i javni anon ključ koji prikazuje `supabase status`. Ključ s administratorskim ovlastima **nikada** ne smije imati `VITE_` prefiks. Zatim:

```sh
npm run dev
```

U PowerShellu koristite `Copy-Item .env.example .env`. Repozitorij sadrži pnpm lockfile; za reproducibilnu instalaciju može se koristiti `pnpm install --frozen-lockfile`.

Bez konfiguracije frontend radi i prikazuje upute za povezivanje; prijava nije lažirana niti postoji lokalni demo zaobilaženjem ovlasti.

### Udaljeni razvojni Supabase

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --include-seed
```

Opcija `--include-seed` primjenjuje i `supabase/seed.sql`; koristite je samo na razvojnoj bazi. Nikakve tablice ne izrađuju se ručno. Postavite VITE varijable na projekt URL / javni ključ. U Supabase Auth URL konfiguraciji dopustite točnu adresu aplikacije i `/nova-lozinka`. Isključite javnu registraciju i postavite minimum lozinke na 12 znakova (lokalni config već to radi). E-mail provider mora ostati uključen za prijavu postojećih računa: `[auth].enable_signup = false`, ali `[auth.email].enable_signup = true`. Za primjenu postavki prvo pregledajte `supabase config diff`, a zatim pokrenite `supabase config push`. Za e-mail u udaljenom okruženju konfigurirajte SMTP; lokalni e-mailovi dostupni su u Mailpit/Inbucket alatu iz `supabase status`.

### Testni računi

```sh
cp .env.seed.example .env.seed
# Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, unique DEMO_PASSWORD,
# and ALLOW_DEMO_SEED=true for a disposable development project.
npm run seed:demo
```

| E-mail                         | Uloge                      |
| ------------------------------ | -------------------------- |
| admin@demo.e-zdravstvo.test    | SYSTEM_ADMIN               |
| lijecnik@demo.e-zdravstvo.test | DOCTOR + INSTITUTION_ADMIN |
| sestra@demo.e-zdravstvo.test   | NURSE                      |
| pacijent@demo.e-zdravstvo.test | PATIENT                    |
| skola@demo.e-zdravstvo.test    | SCHOOL_ADMIN               |

Lozinka je vrijednost koju sami postavite u `DEMO_PASSWORD`. Skripta je ne ispisuje, ne mijenja lozinke postojećih računa i odbija izmjenu računa bez svoje demo oznake. `.env.seed` nije dio Gita. Svi računi u UI-ju nose oznaku „Testni račun”. Klinički seed pokrenite nakon migracija i seed:demo:

```sh
npm run seed:clinical
npm run seed:workflow
```

seed:workflow dodatno čita javni ključ iz .env i prijavljuje testnog liječnika; dokumenti nastaju kroz iste autorizirane RPC funkcije kao u aplikaciji. Lijekovi i dijagnoze su izmišljeni demonstracijski šifrarnici, nisu stvarni MKB ili registar lijekova. Dodatni računi su lijecnik2, lijecnik3 i sestra2 na istoj demo domeni. Postojeći podaci se ne brišu niti prepisuju.

## Vercel

Javna razvojna aplikacija: https://e-zdravstvo.vercel.app. Vercel projekt `e-zdravstvo` povezan je s ovim GitHub repozitorijem. Produkcijska grana je `main`.

`vercel.json` postavlja Vite build, izlaz `dist` i SPA rewrite za izravno otvaranje ruta poput `/ordinacija` i `/central`. Instalacija koristi zaključane verzije iz `pnpm-lock.yaml` i pnpm verziju iz `package.json`.

U Vercel okruženjima Production i Preview potrebne su varijable `VITE_SUPABASE_URL` i `VITE_SUPABASE_ANON_KEY`. U VITE varijable ne unositi service_role ili druge privatne ključeve. `.vercelignore` isključuje lokalne env datoteke, demo lozinke i druge razvojne artefakte iz CLI objave. Supabase konfiguracija uključuje javnu adresu i povratnu rutu `/nova-lozinka`, uz zadržane lokalne adrese.

## Provjera

```sh
npm run build
npm test
npm run test:db
npm run test:clinical
```

DB test primjenjuje migracije u stvarnom PostgreSQL engineu PGlite uz minimalne stubove Supabase infrastrukture. Provjerava RLS, izolaciju ustanova, eskalaciju uloga, suspenziju članstva, audit integritet i privatnost bucketa. To **nije zamjena** za Supabase integracijski test:

1. Primijenite migracije i seed na lokalnom Supabaseu.
2. Prijavite svih pet testnih računa; provjerite početni portal i oznaku testnog računa.
3. Kao liječnik prebacite se na Ustanove; pokušajte `/central` (zabranjeno).
4. Kao pacijent i škola pokušajte `/ordinacija` (zabranjeno).
5. Obnovite lozinku koristeći lokalni e-mail alat i prijavite se novom lozinkom.
6. Odjavite se; zaštićene rute moraju vratiti na prijavu. Provjerite i „Zapamti me”.
7. Provjerite audit događaje u bazi, a neuspjele autentikacije u Supabase Auth audit zapisima.

## Sigurnosni model

Uloge se čitaju iz baze, ne iz korisnički izmjenjivih JWT metapodataka. Uloga djelatnika vrijedi samo uz aktivno članstvo u aktivnoj ustanovi. RLS je stvarna granica ovlasti; frontend guard služi navigaciji. SYSTEM_ADMIN vidi administrativne profile, ustanove i audit; nema automatski pristup medicinskom sadržaju. Administratori ustanova mogu dodjeljivati samo kliničke uloge svoje ustanove, nikada globalne ili administratorske uloge.

Klijenti nemaju izravne INSERT/DELETE ovlasti nad temeljnim tablicama. Izmjena vlastitog imena dopuštena je samo na dva stupca. Administrativni RPC-jevi provjeravaju ovlasti i triggerima bilježe radnje, bez kopiranja osobnih ili medicinskih podataka u audit. Brisanje audit zapisa je zabranjeno; opoziv uloge ostaje zabilježen u auditu. Medicinski zapisi imaju zabranu brisanja. Pregledi koriste povezane verzije; izdani sadržaj dokumenta je nepromjenjiv. Opoziv zadržava sadržaj i potpis.

`LOGIN_SUCCESS` i `LOGOUT` u aplikacijskom auditu su **klijentski prijavljeni događaji** vezani uz provjereni identitet; nisu samostalni dokaz autentikacije. Autoritativne uspješne i neuspješne autentikacije (`LOGIN_FAILED` ekvivalent) vodi Supabase Auth u `auth.audit_log_entries`. Klijent ne može stvarati anonimne lažne sigurnosne događaje. Centralizirani uvoz neuspjelih prijava/IP adresa treba izvesti serverskom integracijom u fazi 7; aplikacijski IP zasad je null, nikada preuzet iz neprovjerenog klijenta.

Medicinski podaci nikad se ne spremaju u localStorage niti query parametre. Samo Auth tokeni koriste sessionStorage ili localStorage kada je odabrano pamćenje. U produkciji koristiti HTTPS, CSP, vlastiti SMTP i provjeru sigurnosti prije stvarnih podataka. RLS se provjerava pri svakom upitu; dodjela nove uloge vidljiva je nakon osvježavanja računa. Realtime pretplata na vlastite obavijesti koristi RLS. Kliničke tablice nemaju izravan SELECT pristup klijenta: čitaju se kroz autorizirane RPC funkcije koje bilježe audit. Sestra čita samo eksplicitno dodijeljene pacijente; medicinske izmjene radi ovlašteni liječnik. Pacijent vidi samo svoj karton čak i ako ima dodatnu liječničku ulogu.

## Struktura i sljedeće faze

```text
src/
  components/ui/   # brand, status, povratne poruke, granica pogreške
  contexts/        # sesija i učitavanje ovlasti
  hooks/           # useAuth
  layouts/         # zajednički okvir portala
  lib/             # tipizirani Supabase klijent, uloge
  pages/auth/      # prijava i obnova lozinke
  pages/           # profil portala, javne informacije
  routes/          # centralni routing i guardovi
  services/        # dohvat računa i audit sesije
  types/           # domenski tipovi
supabase/
  migrations/      # verzionirane promjene baze
  seed.sql
scripts/           # testovi baze i sigurni demo provisioning
```

Faze 2–5 imaju funkcionalni klinički tok, privatne privitke i pacijentov dashboard. Preostaju termini i čekaonica, laboratorij, strukturirani nalazi te rasporedi i napredna administracija skrbnih timova. Pacijentove kartice za termine, nalaze i cijepljenja dodaju se kada postoje odgovarajući moduli, bez lažnih brojki ili praznih ruta. Brojevi prikazanih popisa ograničeni su na 50 pacijenata i 100 najnovijih dokumenata; pretražite pacijenta za njegov karton. Nisu dodane prazne stranice za neimplementirane module.

Ovlasti skrbnog tima i povezivanje novog pacijenta s Auth računom zasad se postavljaju pouzdanim provisioningom/seed skriptom. Liječnik pri kreiranju pacijenta dobiva vlastitu skrbnu vezu. Ne postoji javna samostalna registracija ni preuzimanje tuđeg kartona.

Osnova sigurnosnog pristupa: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase Auth](https://supabase.com/docs/guides/auth), [upravljanje korisničkim profilima](https://supabase.com/docs/guides/auth/managing-user-data).

## Faza 5: privatni privitci i osobni pregled

- Moje e-Zdravstvo počinje stvarnim pregledom aktivnih recepata, uputnica, terapije, liječnika, nedavnih dokumenata i nepročitanih obavijesti. Mobitel ima donju navigaciju.
- Pacijent učitava dokumente u karticu PRIVITCI; liječnik u kartonu pod DOKUMENTI. PDF/JPEG/PNG, najviše 10 MB. Medicinska sestra ima samo čitanje ako ima izričitu skrbnu vezu.
- document_attachments odvojeno čuva metapodatke učitanih datoteka. Izdani, potpisani dokumenti ostaju nepromjenjivi u documents. Učitani dokument nije potvrda autentičnosti izdavatelja.
- Edge funkcija document-files provjerava JWT putem Auth getUser i zatim svaki zahtjev autorizira kroz RPC pod korisnikovim identitetom. Samo zatim koristi serverski Storage ključ. Klijent nema izravne Storage politike za čitanje ili pisanje i ne dobiva potpisane URL-ove.
- Upload provjerava duljinu i početni potpis formata, normalizira ekstenziju te računa SHA-256 na serveru. To je provjera formata/integriteta, ne antivirusna analiza. Preuzimanje ponovno računa hash i vraća Cache-Control: no-store.
- Ponovljeni upload s istim request ID-em ne stvara kopiju. PENDING zapis ostaje skriven dok Storage metadata ne potvrdi dovršen prijenos. Prekid nakon pohrane može se dovršiti ponavljanjem istog zahtjeva. Nema automatskog brisanja nedovršenih originala.
- Samo učitavatelj s aktualnim ovlastima može arhivirati, uz obvezan razlog. Original se čuva i ostaje dostupan autoriziranim korisnicima kroz arhivski filtar.
- Obavijesti se označavaju pročitanima isključivo vlasniku. Upload, izdavanje i opoziv osvježavaju portal preko Realtimea. Cron ez-document-expiry svakodnevno u 06:00 UTC stvara po jedan podsjetnik za recept/uputnicu koja istječe unutar 7 dana.

Nakon migracija treba objaviti i funkciju (serverske SUPABASE varijable Supabase automatski postavlja):

```sh
supabase functions deploy document-files --project-ref YOUR_PROJECT_REF
```

verify_jwt=false u konfiguraciji označava eksplicitnu validaciju unutar funkcije, ne anonimni pristup. Zadržite ovu provjeru i prosljeđivanje korisničkog JWT-a u RPC pozive. Lokalni PGlite test ima minimalni storage.objects stub; stvarni Storage i Edge tok dodatno se testiraju na razvojnom Supabaseu.

Za stvarnu integracijsku provjeru pokrenite `npm run test:files:live` uz razvojne env datoteke. Test stvara jedan izmišljeni PDF i zatim ga arhivira; original ostaje sačuvan prema pravilima medicinske evidencije. Nikada ga ne pokrećite nad stvarnim pacijentima.

## Administracija i osobni potpisi (28. 9. 2026.)

Central (/central) prikazuje statistiku i poveznice na korisnike/ovlasti, ustanove, ambulante/liječnike, predloške, šifrarnike i audit. Korisnici se paginiraju po 50 zapisa. Dodjela uloge ustanove atomarno aktivira članstvo; opoziv vlastite SYSTEM_ADMIN uloge nije dopušten. Kreiranje novih Auth računa još se obavlja pouzdanim provisioningom, bez javne registracije.

Administrator ustanove koristi /ustanove/ambulante i /ustanove/predlosci, samo za vlastite ustanove. Prije izdavanja nove ispričnice unosi šifru liječnika te naziv, šifru, adresu, grad, telefon i e-mail ambulante. Klinički sadržaj administratorima i dalje nije dostupan bez zasebne skrbne ovlasti.

Predlošci REGULAR (redovna nastava) i PE (TZK) imaju nepromjenjive verzije. Uređuju se naslov, uvodni tekst, podnožje, font, veličina, boja, poravnanje i razdjelnik. PDF pregled koristi isti renderer kao izdani dokument, ali izmišljeno dijete i oznaku PREGLED PREDLOŠKA; ne izdaje potpis ili valjani QR. Stari izdani dokument zadržava snapshot predloška, liječnika i ambulante. Istodobna izmjena zastarjele verzije odbija se.

Liječnik odabire razlog i opcionalnu dijagnozu. Šifra bolesti se ispisuje u dokumentu samo uz izričit odabir; javna provjera nikada ne vraća ime učenika, dijagnozu, razdoblje izostanka ni napomene. Mali početni podskup od osam MKB-10 kodova provjeren je u [HZJZ tablici, verzija 2019](https://mkb.hzjz.hr/); nije potpuna klasifikacija. Lokalni/testni kodovi imaju vlastitu oznaku sustava. Administrator može dodavati, deaktivirati i uređivati stavke, bez brisanja povijesti izdanih dokumenata.

Svaki liječnik ima trajni zasebni 256-bitni interni ključ generiran u PostgreSQL-u iz dvije slučajne UUID vrijednosti (244 bita slučajnosti). Ključevi se nalaze u private.doctor_signing_keys i nisu dostupni klijentu niti service_role ulozi. Novi dokumenti koriste HMAC-SHA256 nad kanonskim PostgreSQL JSONB snapshotom; implementacija je provjerena prema RFC 4231. Vidljivi pečat s osobnom oznakom i stilizirano ime renderiraju se iz spremljenog identiteta liječnika. To nije kopija rukopisnog potpisa.

Ovo je **interni elektronički potpis/potvrda sustava**, a ne kvalificirani elektronički potpis, X.509 certifikat, PAdES PDF potpis ili neovisni dokaz neporecivosti. QR potvrđuje zapis i aktualni status na serveru, ne potpisuje proizvoljnu kopiju PDF datoteke. Tu razliku prikazuju detalji potpisa i PDF. Povijesni DEMO_SHA256 dokumenti ostaju provjerljivi i zadržavaju izvornu oznaku. Promjena ili opoziv dokumenta odmah se odražava na provjeri.

Migracije 202609270007 i 202609280001–003 uvode administraciju, zaštićene ključeve, izdavanje novih predložaka i početni šifrarnik. Fontovi Noto Serif i Noto Sans uključeni su uz SIL OFL licencu. Priloženi privatni PDF primjeri, njihov sadržaj i testni izlazi nisu dio repozitorija.

## Termini i čekaonica

Ordinacija ima /ordinacija/termini (dan/tjedan/mjesec) i /ordinacija/cekaonica. Karton ima tab TERMINI; Moje e-Zdravstvo prikazuje sljedeći termin i osobni kalendar. Sva vremena naručivanja tumače se u Europe/Zagreb, ne prema vremenskoj zoni preglednika. Istodobne rezervacije serijaliziraju se po liječniku i pacijentu; preklapanja se odbijaju. Promjena zahtijeva aktualni broj verzije, a prethodni zapis ostaje u appointment_history.

Liječnik upravlja terminima svojih pacijenata; sestra mora imati izričitu skrbnu vezu u ustanovi liječnika. Sestra može naručiti, premjestiti, otkazati i evidentirati dolazak/nedolazak. Samo liječnik termina pokreće i završava pregled. Pacijent ima osobni prikaz samo za čitanje, uključujući račun s više uloga. Central nema pristup rasporedu pacijenata.

Realtime šalje samo osobne obavijesti i promjene oznake rasporeda bez medicinskih podataka. Klijent potom dohvaća autorizirani, auditirani popis. Izravni pristup appointments i appointment_history je zabranjen. Testne termine dodajte naredbom `node --env-file=.env --env-file=.env.seed scripts/seed-appointments.mjs`; ponavljanje ne duplicira postojeće termine.

## Laboratorij

Liječnik otvara karton → LABORATORIJ → Nova laboratorijska narudžba. Dostupne su ustanove s aktivnom ulogom LAB_TECHNICIAN. Laboratorij (/laboratorij) preuzima narudžbu, unosi uzorkovanje, numeričke parametre, jedinice i referentne granice te potvrđuje objavu. Moje e-Zdravstvo → LABORATORIJ prikazuje vlastite narudžbe, rezultate i usporedbu istog parametra/jedinice kroz vrijeme na trenutačnoj stranici (50 narudžbi).

Laboratorijski tehničar ima samo narudžbe vlastite ustanove i podatke potrebne za obradu; ta uloga ne otvara karton. LOW/NORMAL/HIGH računaju se prema granicama koje unese laboratorij; CRITICAL izričito označava laboratorijski djelatnik. Bez referentnih granica nema oznake urednosti. Aplikacija ne određuje medicinske referentne intervale.

Objava je atomarna. Ispravak čuva prethodni nalaz, stvara novu verziju i traži razlog; zastarjeli pokušaj ispravka odbija se. Objavljeni parametri i sadržaj nalaza su nepromjenjivi. Pacijent i skrbni tim dobivaju osvježenje putem Realtimea; objava i ispravak stvaraju osobnu obavijest. Pristupi i izmjene bilježe se u auditu. Demo seed sada uključuje laboratorij@demo.e-zdravstvo.test (isključivo testni račun).

## Administracija skrbnih timova

Central i Ustanove imaju stranicu Skrbni timovi. Administrator ustanove upravlja samo pacijentima svoje ustanove; prikazuju se ime, interni broj, ustanova i status povezivanja računa, bez medicinskog sadržaja. Dodjela/opoziv liječniku ili sestri zahtijeva administrativni razlog i audit zapis. Promjena izabranog liječnika serijalizira se zaključavanjem pacijenta; prethodni liječnik ostaje u skrbnom timu dok se izričito ne opozove.

Samo SYSTEM_ADMIN može prvi put povezati nepovezani karton s postojećim računom koji ima globalnu ulogu PATIENT. Operater potvrđuje identitet osobe prije povezivanja. Već povezani karton ne može se prepisati na drugi račun, a jedan račun može pripadati samo jednom kartonu. Povezivanje ne dodjeljuje administratoru medicinski pristup.
