# Osobní rozvoj DVPP

Sdílená nástěnka pro plánování a reflexi profesního rozvoje. Frontend je statický web pro GitHub Pages; přihlášení, data a oprávnění spravuje Supabase.

## Funkce

- Přihlášení a registrace e-mailem, automatické přijetí potvrzených adres @kcv.cz.
- Název, datum, forma, místo či online zdroj, popis, reflexe a náklady v Kč.
- Všichni schválení členové vidí všechny aktivity, úpravy a mazání jsou pouze pro vlastníka.
- Karty a tabulka, filtry podle garanta a období, statistiky a export CSV.
- Úprava vlastního jména a přehled přihlašovacího účtu.

## Publikace

V nastavení repozitáře **Settings → Pages** vyberte **Deploy from a branch**, větev **main** a složku **/docs**. Každá změna této složky se následně publikuje automaticky.

Obsah `docs/` je veřejná přihlašovací stránka. Týmová data se do repozitáře ani do GitHub Pages nekopírují. Soubor `docs/config.js` obsahuje výhradně veřejné URL a publishable klíč Supabase; přístup k řádkům v databázi chrání RLS. Nikdy sem nevkládejte service_role, secret klíče, hesla, přístupové tokeny ani exporty databáze.

## Supabase

Používá se stávající databázový projekt. Migrace ve složce `supabase/migrations` jsou již v tomto projektu aplikované; nespouštějte je znovu. Pro novou samostatnou instalaci se aplikují v pořadí názvů souborů.

Po publikaci nastavte v **Authentication → URL Configuration** adresu GitHub Pages jako **Site URL** a přidejte ji včetně koncového lomítka do **Redirect URLs**. Původní adresu hostingu můžete ponechat jako další povolenou návratovou adresu. Aplikace odesílá návratovou adresu včetně cesty repozitáře, nikoli jen doménu.

## Vývoj a ověření

```sh
python3 -m http.server 4173 --directory docs
node tests/logout.cjs
```

Build není nutný. Font Sora a jeho OFL licence jsou ve složce `docs/fonts/`, grafické prvky KCV v `docs/assets/`. Klient Supabase se načítá z jsDelivr v konkrétní připnuté verzi. Bez vyplněného Supabase configu běží zřetelně označený ukázkový režim s lokálními daty.


### Přílohy reflexe
Soukromý bucket `dvpp-reflections` a metadata `dvpp_attachments` jsou definované v `supabase/attachments.sql`. Schválení členové týmu mohou soubory stahovat, autor je může přidávat a mazat. Nahrávání probíhá při uložení aktivity, nejdříve v den absolvování. Limit je 5 souborů po 20 MiB; maximální počet se ověřuje pod zámkem aktivity i v databázi. Soubory se mažou přes Storage API před odstraněním metadat a aktivity. Soukromé soubory se stahují s přihlášením, bez veřejných URL. Ukázkový režim drží přílohy v paměti stránky.

Ověření: `node tests/attachments.cjs`, `node tests/detail.cjs`. RLS ověřeno v transakci vrácené přes ROLLBACK: týmové čtení, zákaz zápisu/mazání jinému garantovi, limit 5 příloh a vlastníkovo mazání.
