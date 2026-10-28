# Dovršetak sustava — potvrđeni puni bolnički opseg

Korisnik je 28.10.2026. potvrdio puni bolnički sustav, uključujući hospitalizacije,
krevete, sestrinsku dokumentaciju i primjenu terapije. Ovaj plan bilježi odvojeno
implementaciju, provjere i vanjske preduvjete. Objava pojedine faze nije potvrda
spremnosti cijelog sustava za stvarnu medicinsku dokumentaciju.

| Redoslijed | Isporuka | Stanje |
|---|---|---|
| 1 | Povezani tijek pacijenta, usklađeni statusi nalaza i termina, liječnički pregled nalaza i kontrolne obveze | Implementirano i provjereno za uputnice, bolničke termine i laboratorijske nalaze; ostatak plana ostaje otvoren |
| 2 | Oznake i barkodovi uzoraka, više uzoraka po zahtjevu, odobreni protokoli i verifikacija | Dnevni raspored i praćenje uzoraka postoje; ostalo slijedi |
| 3 | MFA, zaštita sesija i osjetljivih radnji | Slijedi |
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
