# Supplied medical code catalogs

These files are extracted from the two references supplied on 2026-10-11. `manifest.json` identifies the original files and their SHA-256 checksums. This is a versioned reference import, not a live CEZIH connection.

- `mkb.json.gz`: all 39,848 distinct HZJZ MKB codes, with names, chapter/block hierarchy, compact codes and marked codes retained.
- `cezih.json`: 200 specification sections and 1,648 distinct catalog/code pairs from embedded PDF tables. The PDF filename says Rev_BF; its printed footer says RevBE, 2023-07-12. Original section text and table page numbers are retained. Sections that only reference external catalogs remain browseable, without invented entries. In particular, the complete external SKZZ/DTP procedure catalog is not supplied by this PDF.
- Referral types (2.2.5), SKZZ examination complexity (2.2.42), and PZZ charged visit type (2.2.39) remain separate catalogs. An internal appointment category is not an official billing/procedure code.

After applying migrations, run `pnpm run import:catalogs` for a read-only integrity check. Run `pnpm run import:catalogs -- --apply` to import the configured Supabase project, using server-side `SUPABASE_ACCESS_TOKEN` and `VITE_SUPABASE_URL`. Node environments behind the cloud proxy require `NODE_USE_ENV_PROXY=1`. No credentials belong in this directory. Imports upsert without replacing existing diagnosis IDs or deleting legacy local codes. `pnpm run test:catalogs` exercises the full import and authenticated search/issuance against a disposable database.

To reproduce the extraction with Python `openpyxl`, `pdfplumber`, and Poppler `pdftotext` installed:

```sh
python scripts/extract-medical-catalogs.py /path/HZJZ-MKB-List.xlsx /path/01_22_CEZIH_Specifikacija_kodnih_lista_Rev_BF.pdf --output /tmp/medical-catalogs
```

Review extracted code/name pairs and compare counts before replacing the checked-in data. PDF table extraction must use table cells, not whitespace-based guesses from plain text.

Authenticated clinical users can browse the catalogs under **Medicinski šifrarnici**. Diagnosis forms use paged search by code or Croatian name. Referral issuance validates official codes against these catalogs and snapshots the official names before signing. New referral mail attachments use layout version 4; version 3 retries retain their original renderer and bytes.

## HZZO spreadsheet selection, 2026-10-11

`hzzo-manifest.json` accounts for all 52 additional supplied files, including 5 identical extra copies and older editions. `hzzo.json.gz` contains 40 reference tables from 24 selected sources (48,938 distinct list/code pairs). `hzzo-selection.md` explains the latest supplied edition of each family and the remaining provenance questions. These are the latest **supplied** versions, without a claim of live official currency.

Effective dates are selected from worksheet headers when available (PZZ June revision in July remains effective June; August is newer). OLL and DLL stay separate, as do DTS procedure codes and DTS billing groups. Undated medical activities with nine extra codes are retained separately from the dated 2026 edition. The DZO filename's 2029 date is not treated as an effective date. Historical references from 2011/2016 are flagged. All original code strings, source columns, contextual variants, footnotes and medicine restriction/guidance codes are retained. The public provider reference does not create application institutions, doctors or availability; exemption references do not automatically change patient coverage.

Reproduce with `python scripts/extract-hzzo-catalogs.py /path/to/uploaded-files`. Export a text-safe Excel workbook and ZIP with `python scripts/export-hzzo-catalogs.py --output /path/to/exports`. The XLSX exporter preserves leading zeros and disables formula interpretation for exported text.

Run `pnpm run import:hzzo` for integrity validation and `NODE_USE_ENV_PROXY=1 pnpm run import:hzzo -- --apply` to import the configured Supabase project after migration 202610110016. The importer synchronizes only the selected reference lists, verifies per-source counts, and never updates clinical records or issued document payloads. `pnpm run test:hzzo` tests the full source import, source selection, namespaces, prices, variants, footnotes, paging and permissions in a disposable database.
