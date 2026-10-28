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
| 8 | Prijam, hospitalizacije, sobe/kreveti, premještaji, sestrinska skrb, nalozi i evidencija primjene terapije, otpust | Potvrđen puni opseg; nakon zajedničkog tijeka |
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
