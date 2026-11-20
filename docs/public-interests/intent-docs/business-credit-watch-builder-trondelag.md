# Credit watch on named customers, Trøndelag builder (tested)

**Width:** one firm's 4 named customers (example: three Trondheim main contractors and a
housing developer, picked from brreg). Most weeks are quiet; the value is the week one
changes. Swap in the reader's own org numbers; past ~4 customers the run can't open every
announcement list, so it names the ones it skipped.

**Score:** run 1 6/6, but it gave no bostyrer or claims deadline and the fetch summary
read two missing `konkurs` fields as "unknown" → run 2 6/6 after telling the run to open
the konkursåpning notice and that a missing flag means not set.

## Intent doc

```markdown
# Credit watch on my customers and main contractors

## Reader

A Trondheim building firm that invoices these customers and wants to know before an invoice goes unpaid.

Customers (org number, name):

- 983830196 Ruta Entreprenør AS
- 952228609 Backe Trondheim AS
- 859739822 Betonmast Trøndelag AS
- 946629243 Boligbyggelaget TOBB

## Report

- Konkurs, avvikling or tvangsoppløsning for a customer
- Warning signs in the customer's brreg announcements: forhandling om rekonstruksjon, varsel om tvangsoppløsning, revisor resigns or is replaced, new daglig leder, merger or fisjon, kapitalnedsettelse
- Annual accounts more than one year late (sisteInnsendteAarsregnskap older than last year)
- Local news about a customer: payment trouble, stopped building sites, layoffs, big losses

## Skip

- Board changes with no other sign, "Godkjente årsregnskap" filed on time, address changes
- Other firms with similar names
- General news on the building market

## Sources, check first

- https://data.brreg.no/enhetsregisteret/api/enheter?organisasjonsnummer=983830196,952228609,859739822,946629243 (JSON for all customers in one fetch: konkurs, konkursdato, underAvvikling, underTvangsavviklingEllerTvangsopplosning, sisteInnsendteAarsregnskap, antallAnsatte)
- A flag missing from the JSON means it is not set.
- https://w2.brreg.no/kunngjoring/hent_nr.jsp?orgnr=<org number> (each customer's brreg announcements, dated dd.mm.yyyy, newest first). Fetch one per customer, newly flagged customers first.
- For a new konkurs, open its "Konkurs - åpning" announcement: the links on the list are relative, so prefix https://w2.brreg.no/kunngjoring/. It names the bostyrer, the claims deadline (anmeldelsesfrist) and the skiftesamling date.
- A customer reported as konkurs in an earlier brief needs no fetch. If the fetch budget runs out, name the customers not checked.
- Letters æ, ø, å may show as "?" on the announcements page; read around it.

## Search terms

"<customer name>" konkurs; "<customer name>" rekonstruksjon; "<customer name>" Adresseavisen. Adresseavisen is paywalled: use the headline and time, and write "paywalled, details unconfirmed" unless brreg confirms it. Search lags brreg by weeks (it still called a firm "in rekonstruksjon" 18 days after its konkurs); when they disagree, brreg wins.

## Each story must state

- Customer name and org number
- What happened, in one line, and the date in backticks (announcement date or konkursdato)
- What it means for an unpaid invoice: for konkurs, the bostyrer and the claims deadline in backticks; for rekonstruksjon, that claims may be cut and to follow the creditor meeting
- Link to the brreg page or the news story

## No change

Report announcements and news dated in the last 7 days. If this is the first brief (no earlier brief given), also report any customer flagged now, with its date. If nothing is new, write "No change for your 4 customers since <date>. Last accounts filed: <year per customer>." Don't pad.

## Language and place

Read Norwegian. Write in English. Trøndelag, Norway, Europe/Oslo.
```

## Test notes

- Sources checked with WebFetch: the brreg multi-org JSON URL returns JSON; the
  announcements list (`hent_nr.jsp`) and one notice (`hent_en.jsp`) return readable HTML,
  with æøå sometimes garbled. The accounts API (`regnskapsregisteret/regnskap/<nr>`)
  works but costs one fetch per firm, so it was left out.
- Web search found nothing newer than a DN piece on Ruta's rekonstruksjon; no Adresseavisen
  hit for the konkurs.
- Run 2 brief: Ruta Entreprenør AS konkurs opened `2026-11-02` in Trøndelag tingrett,
  claims to the bostyrer by `2026-11-30`, skiftesamling `2026-12-03`; warning signs before
  it: forhandling om rekonstruksjon `2026-09-01`, new daglig leder `2026-10-14`. No change
  for Backe Trondheim and Betonmast Trøndelag (2025 accounts filed June 2026); TOBB flags
  clear, its announcements not checked this run (fetch budget).
