# Automatsko slanje izdanih dokumenata

Nove izdane uputnice i ispričnice te objavljeni specijalistički nalazi, otpusna pisma i laboratorijski nalazi automatski stvaraju PDF potvrdu za dostavu pacijentu. Radne forme ne šalju se. Povijesni dokumenti ne šalju se retroaktivno. Recepti i proizvoljni učitani privici nisu uključeni u ovu promjenu.

Dokumenti se stvaraju postojećim autoriziranim RPC funkcijama `issue_document`, `publish_medical_report` i `publish_laboratory_result`. Migracija `202610110010_document_pdf_email.sql` dodaje odgođene transakcijske okidače: tek nakon spremanja potpisa, detalja i svih laboratorijskih parametara stvaraju privatnu nepromjenjivu snimku za PDF. Izrada ne traži adresu primatelja, tijelo e-maila ni privitak iz frontend koda.

Za pacijenta bez računa koristi se valjana kontaktna adresa iz kartona. Za pacijenta s računom koriste se potvrđena adresa računa i uključene e-mail obavijesti. Opt-out, nepovezana adresa kartona i nepotvrđen račun ne zaobilaze se. Promjena adrese ili vlasništva, arhiviranje pacijenta, opoziv dokumenta ili nova verzija nalaza poništavaju stare čekajuće privitke; već upućenu/poslanu poštu nije moguće opozvati.

E-mail ima neutralan naslov **Vaš dokument u PDF privitku — e-Zdravstvo** i kratku obavijest. Medicinski sadržaj, pacijentovo ime i identifikatori nalaze se u PDF privitku, bez preslikavanja u naslov, HTML ili tekst poruke. PDF sadrži podatke izdanog dokumenta, uključujući izabrane podatke ispričnice i oznaku internog potpisa. Interni potpis nije kvalificirani elektronički potpis. Preuzimanje u pregledniku i slanje novih dokumenata e-mailom koriste zajedničke A4 predloške. Uputnica ima plave rubrike, specijalistički nalaz odvojene cjeline, laboratorijski nalaz tablicu pretraga, rezultata, jedinica i referentnih intervala, a ispričnica sačuvani raspored ordinacije, razdoblja izostanka, osobnog pečata i potpisa. Odabrani predložak ispričnice čuva font, veličinu, poravnanje, boju, naslov i tekst.

Privatne tablice `document_email_outbox` i `document_email_attempts` evidentiraju red i rezultate slanja. Frontend, anonimni korisnici i ostali pacijenti nemaju izravan pristup. Jedan izdani dokument/verzija daje jedan posao, s istim Resend `Idempotency-Key`, istim PDF bajtovima na ponovnom pokušaju, radnom rezervacijom i najviše pet pokušaja unutar 23 sata. Neuspjeh ne poništava izdan dokument. `SENT` znači prihvat Resenda; primitak u sandučiću provjerava se u Resend evidenciji.

Postojeći `notifications-dispatch` sada obrađuje do dva posla obavijesti pregleda i jedan PDF dokument po pozivu. Time se ograničava CPU i sprječava da dokumenti čekaju iza velikog reda drugih obavijesti. Izdavanje dokumenta odmah pokreće ovaj worker nakon commita kroz postojeći Vault token, a raspored svakih pet minuta ostaje za ponovne pokušaje. Portal obavijest ostaje dostupna; dodatni generički e-mail za istu objavu ne šalje se.

Ne trebaju nove varijable okruženja: ponovno se koriste `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`, `APPLICATION_URL` i `NOTIFICATIONS_JOB_TOKEN` u Supabase Edge tajnama te postojeća konfiguracija neposrednog slanja. Pošiljatelj je `e-Zdravstvo <narudzbe@e-zdravstvo.tech>`. Pri nadogradnji izgleda najprije objavite novu `notifications-dispatch` funkciju, zatim primijenite migraciju `202610110011_document_print_layout.sql`. Ona sprema strukturirani model za ispis s `layoutVersion: 2` pri izdavanju, uključujući sve laboratorijske retke i odabrani predložak ispričnice. Stari poslovi zadržavaju izvorni model i prikaz zbog stabilnog sadržaja pri ponovnom pokušaju. Postojeći dokumenti ne šalju se ponovno.

Provjere bez stvarnog slanja: `pnpm test`, `pnpm run test:document-email`, `pnpm run test:email` i `pnpm run test:workflows`. Za stvarnu provjeru izradite dokument ovlaštenim testnim liječnikom za testnog pacijenta s vlastitom adresom; pričekajte nekoliko sekundi i otvorite PDF u pošti. Za račun pacijenta prethodno potvrdite e-mail i uključite obavijesti. Ponovljeno spremanje istog zahtjeva ne smije poslati drugu kopiju. Objavite ispravak nalaza i provjerite novu verziju u privitku. Nemojte stvarati kliničke dokumente stvarnom pacijentu samo radi tehničkog testiranja.

Administratorska provjera bez izlaganja kliničkog sadržaja:

```sql
select status,count(*) from private.document_email_outbox group by status;
select outcome,count(*) from private.document_email_attempts group by outcome;
```
