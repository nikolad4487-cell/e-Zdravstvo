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

## Početna satnica (prema uputi korisnika)

Novi laboratoriji dobivaju pet cjelodnevnih smjena, ponedjeljak–petak 07:00–19:00, i tri pretrage s internim šiframa:

| Pretraga | Uzorkovanje |
| --- | --- |
| Redovne laboratorijske pretrage | 07:00–09:30 |
| Hormoni štitnjače | 07:00–19:00 |
| Deksametazonski test supresije | 08:00–14:00 |

Vrijeme narudžbe i trajanje moraju u cijelosti stati u prozor uzorkovanja. Uz interval 15 minuta posljednji redovni termin počinje u 09:15, za hormone u 18:45, a za test supresije u 13:45. Kombiniranje pretraga koristi presjek njihovih satnica. Ako se unese i točan sat, mora odgovarati prozoru svih odabranih pretraga. Subota i nedjelja nemaju početne smjene.

Pravila se mogu urediti po laboratoriju i pretrazi. „Dodaj standardne pretrage i satnice” dodaje samo nedostajuće interne šifre, bez prepisivanja postojećih izmjena. Povijesna narudžba zadržava snimljeni vremenski prozor i pri promjeni termina; stari zapisi bez prozora koriste prijašnje ponašanje 07:00–19:00. Ovo su organizacijske satnice aplikacije, a ne automatski medicinski protokol ili doziranje deksametazona.

## CEZIH pretrage iz dostavljenog PDF-a

U operativne obrasce povezane su odvojene liste 2.2.30 (43 šifre naručivanja), 2.2.31 (113 šifara rezultata) i 2.2.18 (11 vrsta uzoraka). Izvor je dostavljena specifikacija s otisnutom revizijom RevBE 2023-07-12; ovo nije potvrda aktualnog CEZIH izdanja niti stvarna CEZIH integracija. Šifre 00–10 ostaju tekst. Ne uvodi se pretpostavljeno preslikavanje narudžbe u šifru rezultata ili epruvetu.

Novi laboratoriji dobivaju 43 pretrage naručivanja. Tri stavke s vremenskim točkama (23301-10, 23301-20 i 23301-30) početno su neaktivne za rezervaciju termina dok laboratorij ne potvrdi protokol/trajanje; svih 43 dostupno je za zahtjev laboratoriju. TSH 35510-10 koristi satnicu hormona, a ostale početnu redovnu satnicu. Generički lokalni predlošci redovnih pretraga i hormona se pauziraju; ranije narudžbe čuvaju snimljeni sadržaj. Deksametazonski test ostaje lokalni protokol jer ga PDF ne šifrira. Zajednička usluga više ne koristi nepotvrđenu univerzalnu oznaku VVK/VKK.

U **Bolnički odjeli, ambulante i laboratoriji → Uvezi CEZIH pretrage (43)** ovlašteni administrator/odgovorni liječnik može dodati nedostajuće pretrage. Ponovni uvoz ne prepisuje postavljene satnice ili protokole. Odabrane službene šifre i nazivi provjeravaju se na serveru; korisnik uređuje satnicu, upute i dostupnost.

U naručivanju je dostupna pretraga po nazivu/šifri i odvojeni višestruki izbor vrsta uzoraka. U **Laboratorij → Nova laboratorijska narudžba** može se birati svih 43 šifre ili koristiti slobodan unos za pretrage izvan ovog izvora. Uzorci su snimljeni u narudžbi i PDF potvrdi.

U obrascu nalaza tehničar pretražuje svih 113 šifara rezultata uz paginaciju; server potvrđuje naziv/jedinicu iz izvora. Podržani su brojčani i tekstualni nalazi (npr. napomene). Tekstualne vrijednosti ostaju tekst u prikazu i PDF-u i nisu uključene u brojčane trendove. Referentne vrijednosti i odluke o kritičnim nalazima unosi ovlašteni laboratorij. Raniji nalazi i već pokušani PDF privici ne mijenjaju se.

Dodatno je uspoređen PDF `Specifikacija_kodnih_lista_Rev_F20110628.pdf` (otisnuti datum 2011-06-28): u pregledanim laboratorijskim tablicama ima istih 11 vrsta uzoraka, 37 šifara naručivanja i 107 šifara rezultata. Sve pronađene šifre tog starijeg izvora postoje u dostavljenom izdanju iz 2023.; stariji PDF nije zamijenio operativne podatke.
