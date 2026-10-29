# Dovršetak sustava — potvrđeni puni bolnički opseg

Korisnik je 28.10.2026. potvrdio puni bolnički sustav, uključujući hospitalizacije,
krevete, sestrinsku dokumentaciju i primjenu terapije. Ovaj plan bilježi odvojeno
implementaciju, provjere i vanjske preduvjete. Objava pojedine faze nije potvrda
spremnosti cijelog sustava za stvarnu medicinsku dokumentaciju.

| Redoslijed | Isporuka | Stanje |
|---|---|---|
| 1 | Povezani tijek pacijenta, usklađeni statusi nalaza i termina, liječnički pregled nalaza i kontrolne obveze | Implementirano i provjereno za uputnice, bolničke termine i laboratorijske nalaze; ostatak plana ostaje otvoren |
| 2 | Oznake i barkodovi uzoraka, više uzoraka po zahtjevu, odobreni protokoli i verifikacija | Dnevni raspored, zasebni uzorci, QR oznake, prijam i povijest zamjene implementirani; protokoli čekaju odobreni izvor |
| 3 | MFA, zaštita sesija i osjetljivih radnji | TOTP aktivacija, potvrda prijave i serverska zaštita implementirani; obvezan organizacijski rollout, oporavak i zaštita neaktivnih sesija ostaju otvoreni |
| 4 | Test povrata baze i privatnih privitaka, nadzor, upozorenja, integracijski testovi | Potrebni provjerljivi rezultati oporavka i konfiguracija infrastrukture |
| 5 | Strukturirano propisivanje i provjerene kliničke provjere | Interakcije i doze zahtijevaju odabranu validiranu bazu |
| 6 | Specijalistički obrasci | Potrebni odobreni obrasci i klinički zahtjevi odjela |
| 7 | Životni ciklus šifrarnika i operativno upravljanje ustanovom | Slijedi |
| 8 | Prijam, hospitalizacije, sobe/kreveti, premještaji, sestrinska skrb, nalozi i evidencija primjene terapije, otpust | Prijam, smještaj, premještaji, bilješke i otpust implementirani; terapijski nalozi i evidencija primjene terapije preostaju |
| 9 | Obračun i službene integracije | Potrebne važeće specifikacije, testni pristupi i postupak verifikacije |

Vanjski uvjeti koje nije moguće pretpostaviti: CEZIH/HZZO testni pristup i dopuštena
specifikacija; LIS/analyzer i PACS/DICOM sučelja konkretnih ustanova; odobreni
protokoli pretraga i terapije; pružatelj potrebnog elektroničkog potpisa;
pravila ustanove o čuvanju i pristupu podacima. Tajne se postavljaju u sigurnim
postavkama, nikada u razgovor ili repozitorij.

## Provjera prve isporuke

`pnpm run test:care-pathways` pokriva stvarne SQL migracije, odvajanje pacijenata,
verzije nalaza, eksplicitni pregled, kontrolne obveze, izvor obveze, idempotentnost,
straničenje, opoziv pristupa i povezano zatvaranje laboratorijskog termina.
Kritičan nalaz i dalje zahtijeva postojeću posebnu potvrdu preuzimanja; generički
pregled ga ne zaobilazi. Svaki aktualni specijalistički nalaz ostaje zaseban zadatak,
uključujući više nalaza povezanih s jednim terminom. Medicinska preporuka i rok
kontrole unose se ručno; podsjetnik ne rezervira termin.

Sučelje je dostupno u Ordinacija → Tijek skrbi i obveze te u kartonu ovlaštenog
liječnika. Pretraga i straničenje rade na poslužitelju. Stariji termini bez izričite
veze na nalaz ne povezuju se pretpostavkom na temelju datuma ili imena pacijenta.

## Protokoli ustanove — vanjski preduvjet

Korisnik je potvrdio da protokole još treba pribaviti. OGTT, deksametazonski test i
ostala višestruka uzorkovanja ne dobivaju izmišljene doze, kriterije ni medicinske
korake. Satnice ostaju prethodno potvrđene. Potrebni su odobreni protokoli i
odgovorni stručnjak prije aktivacije tih dijelova.

## Oznake pojedinačnih laboratorijskih uzoraka

Svaki uzorak ima jedinstvenu oznaku, vrstu iz liste 2.2.18, krug uzorkovanja,
verziju i vlastitu nepromjenjivu povijest statusa. Odbijanje traži razlog;
zamjena zadržava vezu na odbijeni uzorak. Vrsta se bira ručno, bez zaključivanja
vrste uzorka ili epruvete iz šifre pretrage. Dokazi o prijamu svih oznaka iz
aktualnog kruga potrebni su prije obrade/izdavanja nalaza. Postojeći zahtjevi bez
oznaka ostaju kompatibilni.

PDF oznaka ima 90 × 50 mm i QR barkod koji sadrži isključivo oznaku uzorka.
Kod se unosi ili skenira čitačem koji unosi tekst u polje; kameraskener nije
uveden ovom isporukom. Pretraga oznake ograničena je na otvoreni zahtjev.
PDF se dohvaća kroz autoriziranu funkciju koja bilježi preuzimanje. Odbijena i
zamijenjena oznaka ne može se ponovno preuzeti za uporabu. Ispis i lijepljenje
na stvaran uzorak zahtijevaju provjeru identiteta laboratorijskog djelatnika.

Provjere: `test:lab-samples`, PDF test i preglednički testovi na računalu/mobitelu.
Ove dvije isporuke ne završavaju preostalu sigurnost, bolnički smještaj, terapijske
naloge, obračun ili službene integracije iz tablice plana.

## TOTP prijava i stanje operativne spremnosti

TOTP koristi Supabase Auth. Korisnik aktivira svoj autentifikator u **Sigurnost
računa**; aplikacija ne može povezati njegov fizički uređaj umjesto njega. Nakon
aktivacije AAL1 sesija čeka potvrdu koda prije učitavanja računa. API pre-request
provjera i restriktivne RLS politike odbijaju AAL1 zahtjeve računa s verificiranim
faktorom, uključujući izravne tablične upite / Realtime. Verifikacija, QR podaci i
uklanjanje faktora idu kroz Auth servis. Tajni ključ nije pohranjen u aplikacijsku
bazu, logove ili lokalnu pohranu. QR se prikazuje samo tijekom aktivacije.

Ovo nije politika obvezne aktivacije za sve djelatnike: računi bez aktiviranog
faktora ostaju kompatibilni. Prije obveznog organizacijskog uvođenja potrebni su
postupak provjere identiteta pri gubitku uređaja, ovlašteni Auth administrator i
uvođenje za sve djelatnike. Oporavak nije zaobilaženje drugim e-mailom; administrator
koristi službeni Auth postupak resetiranja faktora nakon provjere identiteta.

Provjera pružatelja 28.10.2026.: TOTP enrollment/verify uključen, PITR isključen,
API nije prikazao dostupne backup zapise, session timebox i inactivity timeout su 0.
To nije dokaz da je povrat podataka moguć. **Test oporavka nije izveden.** Za njega
su potrebni stvarna kopija i odvojeni potrošni testni projekt. Potrebno je obuhvatiti
i privatne datoteke Storagea; sama kopija baze ne sadrži njihove bajtove.

`NODE_USE_ENV_PROXY=1 node scripts/audit-production-readiness.mjs` ponavlja pregled
bez upisa i ispisuje samo agregate i postavke, bez medicinskih podataka ili tajni.
Za test oporavka nikad ne koristiti aktivnu produkciju kao odredište; prvo se
određuju odredište, dopušteni podaci, siguran prijenos i kriteriji prihvata.
Provjera mora usporediti migracije, prava pristupa, osnovne tokove te dostupnost i
integritet privatnih privitaka. Uspješan export ili postojanje backupa nisu dokaz
uspješnog oporavka.

## Bolnički prijam i dokumentacija skrbi

Administrator u **Bolnički smještaj** postavlja odjele i stvarne oznake soba/kreveta.
Nisu unaprijed otvoreni izmišljeni produkcijski kreveti ili hospitalizacije.
Liječnik u **Hospitalizacije** ili otvorenom kartonu evidentira prijam uz razlog i
slobodan krevet. Aktivni prijam ima jedinstveni krevet i jedinstvenog pacijenta;
konkurentni i neuspjeli upisi ne gube prethodni smještaj. Deaktivacija zauzetog
kreveta/odjela nije dopuštena. Premještaji čuvaju izvorne oznake u povijesti.

Aktivni liječnici skrbnog tima u istoj ustanovi upravljaju hospitalizacijom;
sestrinski pristup zahtijeva izričitu dodjelu pacijentu u toj ustanovi. Administrator
ne dobiva klinički pristup kroz upravljanje krevetima. U središnjem tijeku skrbi
liječnik prati hospitalizaciju svog pacijenta, dok su detaljne interne bilješke
ograničene na odgovarajući bolnički tim. Prava se ponovno provjeravaju pri svakoj
radnji. Nije uvedeno automatsko proširenje pristupa svim djelatnicima odjela.

Bilješke su odvojene na liječnički tijek i sestrinske zapise. Izvornik i snimka
imena autora čuvaju se; ispravak stvara povezanu novu verziju s razlogom. Povijest
bilježaka dostupna je po stranicama, uključujući stare verzije. Osvježavanje preko
obavijesti/fokusa ne uništava otvoreni nespremljeni nacrt. Događaji smještaja i
skrbi bilježe stvarni korisnički identitet i vrijeme.

Otpusno pismo izrađuje se postojećim izdavanjem nalaza uz izričitu vezu na prijam.
Odabire se autentificirani liječnički profil odgovarajuće bolnice, čak i kada isti
korisnik ima profil u drugoj ustanovi. Ispravak ne može promijeniti bolničku epizodu
izvornika. Otpust zahtijeva aktualno otpusno pismo tog prijama te atomarno završava
hospitalizaciju i oslobađa krevet. Ispravno se koristi hrvatski datum pri izdavanju
bolničkog nalaza. Raniji izdani dokumenti i poslovi dostave ne prepisuju se.

To još nije cijeli bolnički HIS: strukturirani terapijski nalozi, evidencija svake
primjene lijeka, operacijski tokovi, obračun i vanjske integracije ostaju otvoreni.
Postojeći interni potpis i autorizacija nisu potvrda kvalificiranog potpisa niti
stručne validacije za uporabu sa stvarnom medicinskom dokumentacijom.

Provjere: `test:inpatient`, kliničke/sigurnosne SQL provjere, preglednik na računalu
/mobitelu. Isporuka zahtijeva sve migracije do `202610280004` i minimalnu javnu
verziju sheme `2026102804`; korisničko sučelje odbija stariju shemu.
