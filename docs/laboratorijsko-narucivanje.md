# Laboratorijsko naručivanje i terapija

## Korištenje

U otvorenom kartonu odaberite **Naruči prioritetni pregled → Vrsta naručivanja → Laboratorij / uzimanje uzorka**. Odaberite bolnicu, odjel, laboratorijsku uslugu, jednu ili više pretraga i način uzimanja uzorka. Termini prate radnu smjenu usluge, trajanje odjela (15/30 minuta), odsutnosti i postojeće rezervacije. Pretrage s obveznim satom (npr. 08:00) nude samo taj sat; različiti obvezni sati zahtijevaju zasebne narudžbe. Zatim povežite važeću dijagnostičku/laboratorijsku uputnicu ili izradite novu A3/A6 i potvrdite prioritetnu narudžbu.

Slanje koristi postojeći Resend, red isporuke i zaštitu od duplikata. Nove varijable okruženja nisu potrebne. PDF sadrži šifru usluge, odabrane pretrage, način uzimanja uzorka i upute. Tekst e-maila ne uključuje pretrage, nalaze ni medicinske upute. Neuspjela dostava ne briše narudžbu. Isti detalji dostupni su ovlaštenom timu i pacijentu u popisu narudžbi. Promjena termina zadržava snimljeni protokol i obvezni sat, a postojeći sustav šalje obavijesti o promjeni/otkazivanju.

U kartonu **Terapija → Dodaj terapiju** dostupna je ista pretraga lijekova OLL/DLL kao na receptu. Sprema se točno pakiranje i šifra; kasnija izmjena šifrarnika ne mijenja naziv i pakiranje već evidentirane terapije. Postojeći pregled aktivne/završene terapije i postupci završetka/prekida terapije ostaju dostupni.

## Postavljanje ustanove

1. Administrator u **Bolnički odjeli, ambulante i laboratoriji** dodaje odjel, npr. „Laboratorij – endokrinologija”, s intervalom 15 ili 30 minuta.
2. Za odjel dodaje **Laboratorijsku uslugu**, povezuje stvarnog odgovornog liječnika ustanove, naziv usluge, lokaciju i šifru postupka (npr. korisnikov VVK za uzimanje venske krvi). Aplikacija ne potvrđuje automatski da ručno unesena šifra ima status službene HZZO šifre.
3. Postavlja smjene laboratorijske usluge; odgovorni liječnik može održavati svoje smjene. Koriste se postojeća prava pristupa i sukobi u rasporedu odgovornog liječnika. Ovo ne uvodi paralelni višekanalni kapacitet uzorkovališta.
4. Odgovorno osoblje u odabranom laboratoriju dodaje pretrage: naziv, internu/službenu šifru ako je poznata, obvezni sat ako postoji, pisanu pripremu i opcionalne povezane korake.
5. Svaki korak ima dan u odnosu na glavni termin (−1 prethodni, 0 isti dan), vrijeme, naziv i uputu. Koraci predstavljaju plan pripreme i **ne rezerviraju dodatne termine**. Za drugo uzorkovanje koje zauzima laboratorijski termin napravite zasebnu narudžbu.

Za test supresije laboratorij/liječnik unosi odobreni protokol. Aplikacija ne pretpostavlja lijek, dozu, vrijeme uzimanja lijeka ni medicinske uvjete testa. Bez potvrđenog rasporeda ne stvaraju se izmišljeni slobodni termini niti se postojeći liječnici automatski dodjeljuju novoj usluzi.

## Provjere

`pnpm run test:lab-booking` provjerava raspored u Europe/Zagreb, fiksni sat, skrivene zauzete termine, uputnice, atomsko spremanje i ponavljanje zahtjeva, zaštitu od zaobilaženja, nepromjenjivost protokola i prava pristupa. `pnpm run test:prescription-catalog` uključuje terapiju i snimljeno pakiranje. Browser testovi pokrivaju laboratorijsko naručivanje na računalu/mobitelu i terapiju. Unit testovi potvrđuju PDF i odvajanje medicinskih uputa od teksta e-maila. Stari PDF renderer čuva identične privitke postojećih zahtjeva pri ponovnom slanju.
