# Readable sources for niches whose main site blocks Scout

Checked 20 Nov 2026 with curl and the web fetch tool. ✓ = readable or a live, dated
feed. Re-check each one with the run's own fetch tool before you put it in an intent doc.
Niche rows in `norway.md`, `nordics.md` and `world.md` that list a blocked source should
use these instead.

## Norway

- **NAV rules:** nav.no rule pages ✓, with "Oppdatert <date>" in the page text (e.g.
  nav.no/dagpenger). nav.no/rss ✓, sparse.
- **Skatteetaten:** skatteetaten.no/rss/presse/pressemeldinger/ ✓. More feeds at
  skatteetaten.no/rss/.
- **UDI:** udi.no/presse/ ✓ dated. No RSS.
- **HK-dir tests:** prove.hkdir.no/norskprove-a1-b2 ✓ (next registration date), plus
  /statsborgerprove and /samfunnskunnskapsprove.
- **regjeringen.no:** RSS regjeringen.no/no/rss/Rss/2581966/ ✓.
- **Doffin:** still none. The site is JavaScript only and api.doffin.no needs a key. Drop
  the tenders niche or ask chief for a keyed fetch.

## Nordics

- **Migrationsverket:** RSS migrationsverket.se/rss ✓, plus topic feeds such as
  /rss_arbeta. The news archive page is JavaScript.
- **Migri:** RSS migri.fi/en/home/-/asset_publisher/V8vRRxkPopU1/rss ✓. Full list at
  migri.fi/en/rss-feeds.
- **Denmark, immigration:** nyidanmark.dk has no RSS. Its homepage carries dated news
  links, and uim.dk/nyhedsarkiv/ ✓ dated (the immigration ministry).
- **Denmark, tax:** skat.dk has no news list. Use skm.dk/aktuelt/presse-nyheder/pressemeddelelser
  ✓ dated (the tax ministry).
- **Socialstyrelsen:** socialstyrelsen.se/om-socialstyrelsen/pressrum/ ✓ dated.
- **Vinnova:** JSON API data.vinnova.se/api/utlysningar/<from-date> ✓ dated, no key.
- **Naturvårdsverket:** naturvardsverket.se/om-oss/aktuellt/nyheter-och-pressmeddelanden/
  ✓ dated.
- **Stockholm housing queue:** bostad.stockholm.se/nyhetsarkiv/ ✓ dated, with monthly queue
  times.
- **Netherlands (IND):** ind.nl/en/news ✓, few dates. No RSS.

## World

- **US green cards (EB-2 NIW, Visa Bulletin):** travel.state.gov is 403.
  - uscis.gov/newsroom/all-news ✓ dated.
  - The USCIS filing-charts page ✓ dated: it says which bulletin chart applies each month.
  - Federal Register RSS for USCIS ✓.
  - Law-firm feeds ✓: wolfsdorf.com/feed/, murthy.com/feed/, visaenvoy.com/feed/.
- **Australia invitation rounds:** homeaffairs.gov.au is 403.
  - widen.com.au/invitation-rounds/ ✓ dated, round by round.
  - abc.net.au/news/topic/immigration ✓.
  - visaenvoy.com/feed/ ✓.
- **Germany (Blue Card, Chancenkarte):** make-it-in-germany shows a bot wall.
  - BAMF RSS ✓: bamf.de/SiteGlobals/Functions/RSS/DE/Feed/RSSNewsfeed_Meldungen.xml?nn=282672.
  - thelocal.de/feeds/rss.php ✓.
  - BMAS RSS ✓.
  - Federal Law Gazette RSS ✓: recht.bund.de.
- **Counter-Strike:** hltv.org/rss/news ✓, even though its HTML is 403.
  store.steampowered.com/feeds/news/app/730/ ✓ (official updates).
- **Etsy seller policy:** etsy.com is 403.
  - community.etsy.com Announcements board ✓. Dates are in the titles only, and posts are
    sorted by latest activity.
  - valueaddedresource.net/tag/etsy/rss/ ✓ dated.
- **YouTube monetisation:**
  - blog.youtube/rss/ ✓ dated.
  - The Creator Insider channel feed ✓.
  - tubefilter.com/feed/ ✓.
  - Avoid support.google.com help pages: about 1.6 MB, cut before any date.
