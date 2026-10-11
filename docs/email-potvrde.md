# E-mail potvrde pregleda

Rezervacije u ordinaciji spremaju se u `public.appointments`, a bolničke narudžbe u `public.hospital_bookings` s terminom u `public.hospital_slots`. Postojeće autorizirane RPC funkcije ostaju mjesto zakazivanja, promjene i otkazivanja. Okidači u istoj transakciji stvaraju obavijest i privatni red dostave. Resend se poziva naknadno iz Supabase Edge funkcije `notifications-dispatch`; neuspjeh dostave ne poništava rezervaciju.

## Varijable i mjesto postavljanja

U **Supabase Dashboard → odabrani projekt → Edge Functions → Secrets** postavite:

| Naziv | Vrijednost / namjena |
| --- | --- |
| `RESEND_API_KEY` | API ključ iz Resenda s dopuštenjem za slanje preko verificirane domene. Unesite ga samo u sigurno polje za tajne. |
| `NOTIFICATION_FROM_EMAIL` | Točno `e-Zdravstvo <narudzbe@e-zdravstvo.tech>`; funkcija odbija drugog pošiljatelja. |
| `APPLICATION_URL` | Javni HTTPS URL aplikacije, primjerice `https://e-zdravstvo.tech`. |
| `NOTIFICATIONS_JOB_TOKEN` | Zasebna nasumična tajna za raspored dostave. Mora odgovarati tokenu rasporeda/Vaulta. Postojeći raspored već koristi svoj token; nemojte ga mijenjati samo radi ove nadogradnje. |

`SUPABASE_URL` i `SUPABASE_SERVICE_ROLE_KEY` Supabase postavlja Edge funkciji automatski. Resend ključ **ne treba dodavati u Vercel frontend**, `VITE_*` varijable, repozitorij ili razgovor. Frontend zadržava postojeći javni Supabase URL i anon ključ.

Za novu instalaciju primijenite migracije do `202610110009_immediate_booking_email.sql`, objavite `notifications-dispatch` uz isključenu gateway JWT provjeru (`supabase functions deploy notifications-dispatch --no-verify-jwt`) i konfigurirajte POST poziv svakih pet minuta s `Authorization: Bearer <NOTIFICATIONS_JOB_TOKEN>`. Funkcija sama provjerava taj token, ignorira tijelo zahtjeva i dohvaća samo serverski red. Nema API-ja za odabir proizvoljnog primatelja ili sadržaja.

Migracija `202610110009` odmah pokreće obradu nove potvrde zakazivanja, promjene ili otkazivanja pomoću transakcijskog `pg_net` reda. HTTP poziv počinje nakon uspješnog završetka transakcije. Rezervacija ne čeka odgovor Resenda. Postojeći raspored svakih pet minuta ostaje za ponovne pokušaje i podsjetnike; nova potvrda više ne čeka taj ciklus.

Za aktivaciju projekt mora imati `pg_net` i Vault. U Vaultu spremite isti token koji koristi `NOTIFICATIONS_JOB_TOKEN`; postojeća instalacija već koristi tajnu naziva `ez-notifications-job-token`. Kao projektni administrator konfigurirajte URL vlastitog projekta i **naziv** Vault tajne, bez upisivanja samog tokena u SQL:

```sql
select public.configure_notification_dispatch(
  'https://PROJECT_REF.supabase.co/functions/v1/notifications-dispatch',
  'ez-notifications-job-token'
);
```

Frontend nema ovlasti konfigurirati ni izravno pokretati ovaj mehanizam. Automatski okidač radi samo za spremljene događaje pregleda; generičke obavijesti i podsjetnici ne stvaraju rekurzivne pozive. Ako HTTP zahtjev nije moguće staviti u red, termin i potvrda ostaju spremljeni za rezervni raspored. Isključivanje neposrednog pokretanja: `select public.configure_notification_dispatch(null,null);`.

Nakon postavljanja tajni i objave funkcije uključite uslugu u Supabase SQL Editoru:

```sql
select public.configure_notification_delivery(true);
```

SQL izvršite kao projektni administrator, nikada preko javnog klijenta. Funkciju inače smije pozvati samo serverska uloga `service_role`. Aktivacija ne mijenja postavke pacijenata s računom. Migracija `202610110006` jednom dodaje potvrde za postojeće buduće bolničke rezervacije pacijenata bez računa s valjanom adresom u kartonu; prošli i otkazani pregledi ne uključuju se.

## Stanje povezane instalacije

Na povezanom projektu migracije i funkcija objavljene su 11. listopada 2026. Gore navedene tajne su postavljene, dostava je uključena, neposredno pokretanje aktivirano je kroz postojeći Vault token, a raspored svakih pet minuta sačuvan je za ponovne pokušaje. `APPLICATION_URL` koristi provjereni `https://e-zdravstvo.vercel.app`. Početna pogreška Resenda HTTP 403 za neverificiranu domenu razriješena je: Resend je prihvatio potvrde promjene, otkazivanja i nove narudžbe; korisnik je potvrdio primitak promjene i otkazivanja. Ako se pogreška vrati, provjerite pripada li ključ istom računu/timu u kojem je domena Verified. Resend Templates nisu potrebni: aplikacija šalje vlastiti HTML i PDF kroz API. Za ovu nadogradnju ne treba mijenjati tajne.

## Kada se šalje

Pacijentu **bez korisničkog računa** potvrde se šalju na valjanu e-mail adresu iz njegova kartona. Ovlašteni liječnik unosi adresu kroz **Uredi pacijenta**. Ako adresa nedostaje ili nije valjana, pregled ostaje zakazan, a aplikacija prikazuje da treba unijeti adresu.

Pacijent **s korisničkim računom** koristi potvrđenu adresu za prijavu i uključenu postavku **Obavijesti e-poštom** u **Moje e-Zdravstvo → Postavke**. Za taj račun nema automatskog prelaska na kontaktni e-mail kartona; postojeći izbor isključenih obavijesti poštuje se.

- Novo zakazivanje: potvrda pregleda, uključujući oznaku PRIORITETNI za takvu narudžbu.
- Promjena termina: obavijest s novim datumom i vremenom.
- Otkazivanje: zasebna obavijest o otkazivanju.

HTML na hrvatskom koristi svijetli predložak potvrde: kartica s oznakom e-Zdravstvo, naslovom i statusom, podacima u jednom stupcu, pozdravom i napomenom da se na poruku ne odgovara. Prilagodljiva širina i tekstualna inačica podržavaju mobitele i klijente bez HTML-a. Datum i vrijeme uvijek se prikazuju u zoni `Europe/Zagreb`, uz ljetno/zimsko računanje vremena. Uključeni su ime pacijenta, ustanova, liječnik, vrsta pregleda, datum, vrijeme, lokacija i broj rezervacije. Broj `PREG-<godina>-<redni broj>` dolazi iz privatne evidencije stvarne rezervacije i ostaje isti pri promjeni ili otkazivanju. Već pokušani stari poslovi zadržavaju svoju izvornu snimku podataka. Ako adresa ustanove nedostaje, pacijenta s računom upućuje se na portal, a pacijenta bez računa na liječnika. Slobodni tekst vrste pregleda u ordinaciji koristi sigurnu opću oznaku ako nije jedna od standardnih vrsta; time se ne prenose eventualno upisani simptomi ili dijagnoze. Bolnica koristi naziv pregleda iz kataloga usluga. U katalogu zato koristite nazive vrsta pregleda, a ne medicinske podatke pojedinog pacijenta.

Svaka potvrda pregleda, promjena i otkazivanje uključuju PDF privitak. PDF na bijeloj A4 stranici prati raspored bolničke narudžbe: zaglavlje ustanove, trajni broj, status, podaci pacijenta, usluga, datum narudžbe, termin, lokacija, liječnik i upute. Datum rođenja, adresa i telefon pacijenta pojavljuju se samo u PDF-u, prema privatnoj snimci rezervacije. MBO i šifra postupka nisu strukturirani u postojećem modelu i prikazuju se kao „Nije evidentirano”; ne preuzimaju se iz oglednog dokumenta ni slobodnog teksta osiguranja. QR kod sadrži samo broj rezervacije.

Privitak se izrađuje na poslužitelju preko postojećih `pdf-lib`, `fontkit` i `qrcode` paketa. Font s hrvatskim znakovima uključen je u funkciju, bez vanjskih preuzimanja. Fiksni metapodaci omogućuju identične PDF bajtove pri ponovnom pokušaju. PDF se šalje Resendu kao base64 privitak, bez javnog linka ili pohrane u javni bucket. Dispatcher obrađuje do tri poruke po pozivu kako bi ograničio CPU pri izradi PDF-a; ostale ostaju u redu.

U porukama i PDF-u nema dijagnoze, sadržaja uputnice, nalaza, terapije, razloga prioriteta, promjene ili otkazivanja. Vrijednosti su HTML-escaped. Za pacijenta s računom poveznica vodi na portal i zahtijeva prijavu. Pacijent bez računa dobiva sve podatke za dolazak i uputu da se za dodatne informacije ili promjenu termina obrati liječniku, bez poveznice ili uputa za prijavu.

## Pouzdanost i evidencija

Jedinstveni ključ obavijesti u redu, zaključavanje `SKIP LOCKED`, vremenski ograničene radne rezervacije i stalni Resend `Idempotency-Key` sprečavaju ponovno slanje pri uobičajenim ponavljanjima zahtjeva i radu više izvršitelja. Novi termin ili otkazivanje imaju zasebnu poruku; zastarjele poruke koje čekaju obradu otkazuju se. Već poslani e-mail ili zahtjev koji je već upućen Resendu nije moguće opozvati.

Najviše je pet pokušaja. Ponovni pokušaji prestaju nakon 23 sata od prvog pokušaja kako ne bi prešli Resendov 24-satni prozor idempotencije. Neizvjesna dostava ostaje evidentirana za provjeru, bez automatskog ponovnog slanja nakon tog prozora. `SENT` znači da je Resend prihvatio poruku, a ne dokaz dolaska u sandučić; za dostavu/odbijanje provjerite Resend Emails.

Privatne tablice nisu dostupne frontend ulogama:

- `private.notification_email_outbox`: stanje PENDING/SENDING/SENT/FAILED/CANCELLED, broj pokušaja, vrijeme slanja i Resend ID.
- `private.notification_email_attempts`: rezultat svakog završenog pokušaja i istekle radne rezervacije, bez sadržaja e-maila, adrese primatelja ili odgovora pružatelja.
- `private.booking_email_references`: jedinstveni trajni brojevi ordinacijskih i bolničkih rezervacija.
- `private.appointment_email_snapshots`: stabilni podaci potvrde za ponavljanje istog zahtjeva.
- `private.contact_appointment_email_events`: privatni događaji, kontaktna adresa i stabilni podaci potvrde za pacijente bez računa. Promjena adrese, povezivanje računa ili arhiviranje pacijenta poništavaju čekajuće kontaktne poruke.

Za pregled stanja u administratorskom SQL Editoru, bez izlaganja osobnih podataka:

```sql
select status, count(*) from private.notification_email_outbox group by status;
select outcome, count(*) from private.notification_email_attempts group by outcome;
```

FAILED poruke usporedite s Resend evidencijom prije eventualnog ručnog postupanja; nemojte naslijepo vratiti već prihvaćene poruke u red.

Edge Functions → `notifications-dispatch` → Logs prikazuje sigurne kodove pogreške, primjerice `RESEND_DOMAIN_NOT_VERIFIED`, `RESEND_AUTHENTICATION_FAILED`, `RESEND_ACCESS_DENIED` ili `DELIVERY_PREPARATION_OR_NETWORK_FAILED`. Ne zapisuje sadržaj odgovora Resenda, adrese ni tajne. Isti kodovi nalaze se u sažetku odgovora za autentificirani serverski raspored. Neuspjeli zahtjev ne mora stvoriti zapis poslanog e-maila u Resend → Emails. Pri promjeni termina aplikacija dohvaća stvarno stanje reda i ne tvrdi da je pacijent obaviješten samo zato što je termin spremljen.

## Testiranje

Automatizirano, bez slanja stvarne pošte i bez produkcijskih podataka:

```sh
pnpm test
pnpm run test:email
pnpm run test:priority
pnpm run test:workflows
pnpm run build
```

Testovi provjeravaju HTML escaping, hrvatske predloške, vremensku zonu, otkazivanje, promjenu termina, odbijanje pogrešnog pošiljatelja, ograničenja pristupa, stabilan ključ ponavljanja, evidentiranje greške i očuvanje rezervacije. SQL testovi koriste izoliranu PGlite bazu s izmišljenim podacima; HTTP testovi zamjenjuju Resend odgovor.

Za provjeru stvarne dostave koristite vlastitu adresu u testnom kartonu:

1. Za pacijenta bez računa unesite vlastitu valjanu adresu u **Uredi pacijenta → E-mail**. Za pacijenta s računom potvrdite adresu računa i uključite **Obavijesti e-poštom**, pa spremite postavke.
2. Kao ovlašteni liječnik zakažite budući pregled tom pacijentu. Obrada potvrde pokreće se odmah nakon spremanja; uobičajeno pričekajte nekoliko sekundi. Stvarni dolazak u sandučić ovisi i o pružatelju pošte. Ako pokretanje ili slanje ne uspije, postojeći raspored ponavlja pokušaj svakih pet minuta.
3. Provjerite sandučić i neželjenu poštu te Resend → Emails. Pošiljatelj mora biti `e-Zdravstvo <narudzbe@e-zdravstvo.tech>`, a detalji odgovarati portalu. Provjerite prikaz na mobitelu i otvorite PDF privitak; broj, podaci pacijenta i termin moraju odgovarati rezervaciji.
4. Promijenite termin, pričekajte dostavu i provjerite novu poruku s novim datumom/vremenom. Zatim otkažite pregled i provjerite obavijest o otkazivanju.
5. Ponovite spremanje istog zahtjeva ili izvršavanje rasporeda: već poslana potvrda ne smije doći ponovno.

Greške Resenda testirajte automatiziranim testovima ili na zasebnom razvojnom projektu, bez namjernog kvarenja produkcijskog ključa. Rezervacija ostaje dostupna u portalu i kada dostava ne uspije.
