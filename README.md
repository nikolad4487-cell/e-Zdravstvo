# e-Zdravstvo

Integrirani digitalni zdravstveni sustav — **faza 1**. Originalna razvojna aplikacija, nije povezana s CEZIH-om, HZZO-om, e-Građanima ni drugim službenim sustavima. Isključivo izmišljeni testni podaci; nije spremna za stvarnu medicinsku dokumentaciju.

## Što je implementirano

- React 19, Vite, TypeScript strict, React Router, Tailwind CSS i Lucide.
- Responsive prijava, izbor konteksta djelatnik/građanin, prikaz lozinke, opcija pamćenja sesije, obnova lozinke i odjava.
- Prava Supabase Authentication prijava **e-mailom**; korisnička imena još nisu uvedena. Izbor konteksta na prijavi ne mijenja ovlasti.
- Osam uloga, više uloga po korisniku, preusmjeravanje i zaštićeni portali. Višestruke uloge omogućuju promjenu portala u sidebaru.
- Funkcionalna početna stranica računa: stvarni profil, aktivne uloge i ustanove iz baze; bez izmišljenih kliničkih statistika.
- SQL migracije: `profiles`, `institutions`, `institution_departments`, `institution_users`, `user_roles`, `audit_logs`, UUID, FK, indeksi, constraints, RLS, updated_at i audit triggeri.
- Kontrolirane SQL funkcije za ustanove, članstva, dodjelu i opoziv uloga. Administratorski UI za te radnje dolazi u fazi 7.
- Privatni Supabase Storage bucket, namjerno bez pristupa objektima dok faza 5 ne uvede vlasništvo i metapodatke dokumenata.
- Idempotentni referentni seed i skripta za pet stvarnih testnih Auth računa.

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
supabase db push
```

Referentni `supabase/seed.sql` primijenite CLI-jem ili preko `psql "$DATABASE_URL" -f supabase/seed.sql` samo na razvojnoj bazi. Nikakve tablice ne izrađuju se ručno. Postavite VITE varijable na projekt URL / javni ključ. U Supabase Auth URL konfiguraciji dopustite točnu adresu aplikacije i `/nova-lozinka`. Isključite javnu registraciju i postavite minimum lozinke na 12 znakova (lokalni config već to radi). Za e-mail u udaljenom okruženju konfigurirajte SMTP; lokalni e-mailovi dostupni su u Mailpit/Inbucket alatu iz `supabase status`.

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

Lozinka je vrijednost koju sami postavite u `DEMO_PASSWORD`. Skripta je ne ispisuje, ne mijenja lozinke postojećih računa i odbija izmjenu računa bez svoje demo oznake. `.env.seed` nije dio Gita. Svi računi u UI-ju nose oznaku „Testni račun”. Veći klinički seed (3 liječnika, 2 sestre, 10 pacijenata i medicinska dokumentacija) dolazi s odgovarajućim modulima.

## Provjera

```sh
npm run build
npm test
npm run test:db
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

Uloge se čitaju iz baze, ne iz korisnički izmjenjivih JWT metapodataka. Uloga djelatnika vrijedi samo uz aktivno članstvo u aktivnoj ustanovi. RLS je stvarna granica ovlasti; frontend guard služi navigaciji. SYSTEM_ADMIN u ovoj fazi vidi administrativne profile i ustanove, a buduće kliničke politike neće podrazumijevati administratorski pristup medicinskom sadržaju. Administratori ustanova mogu dodjeljivati samo kliničke uloge svoje ustanove, nikada globalne ili administratorske uloge.

Klijenti nemaju izravne INSERT/DELETE ovlasti nad temeljnim tablicama. Izmjena vlastitog imena dopuštena je samo na dva stupca. Administrativni RPC-jevi provjeravaju ovlasti i triggerima bilježe radnje, bez kopiranja osobnih ili medicinskih podataka u audit. Brisanje audit zapisa je zabranjeno; opoziv uloge ostaje zabilježen u auditu. Budući medicinski zapisi koristit će verzioniranje/arhiviranje.

`LOGIN_SUCCESS` i `LOGOUT` u aplikacijskom auditu su **klijentski prijavljeni događaji** vezani uz provjereni identitet; nisu samostalni dokaz autentikacije. Autoritativne uspješne i neuspješne autentikacije (`LOGIN_FAILED` ekvivalent) vodi Supabase Auth u `auth.audit_log_entries`. Klijent ne može stvarati anonimne lažne sigurnosne događaje. Centralizirani uvoz neuspjelih prijava/IP adresa treba izvesti serverskom integracijom u fazi 7; aplikacijski IP zasad je null, nikada preuzet iz neprovjerenog klijenta.

Medicinski podaci nikad se ne spremaju u localStorage niti query parametre. Samo Auth tokeni koriste sessionStorage ili localStorage kada je odabrano pamćenje. U produkciji koristiti HTTPS, CSP, vlastiti SMTP i provjeru sigurnosti prije stvarnih podataka. RLS se provjerava pri svakom upitu; dodjela nove uloge vidljiva je nakon osvježavanja računa. Realtime pretplate dodaju se u fazi 5 uz domenske događaje.

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

Faza 2 uvodi `doctors`, `patients`, `patient_doctors`, ustanove i kartone. Faza 3 uvodi preglede, dijagnoze i terapiju. Faza 4 izdavanje recepata, uputnica i ispričnica s demonstracijskim potpisom i javnom minimalnom provjerom. Faza 5 pacijentove dokumente, Storage politike i Realtime. Faza 6 termine, čekaonicu, laboratorij i nalaze. Faza 7 administrativne nadzorne ploče i prošireni sigurnosni audit. Domenske tipove i tablice dodavati zajedno s funkcionalnim tokovima, bez praznih placeholder modula.

Osnova sigurnosnog pristupa: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Supabase Auth](https://supabase.com/docs/guides/auth), [upravljanje korisničkim profilima](https://supabase.com/docs/guides/auth/managing-user-data).
