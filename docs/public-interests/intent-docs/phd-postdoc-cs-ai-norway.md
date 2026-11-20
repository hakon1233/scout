# PhD and postdoc jobs in computer science and AI, Norway (tested)

**Width:** one field, whole country. Narrower (one university) has about one new ad a
month; wider (all PhDs) is 30+ ads a week and needs no curation. Computer science and AI
gives about 3–8 new ads a week across UiO, NTNU, UiS, UiB, Simula and NORCE.

**Score:** run 1 5/6 (pulled in a precision-psychiatry postdoc on the keyword; web search
spent on closed spring ads) → run 2 6/6 with a tighter Skip test and Simula's own list,
which found the Simula "AI Agent Networking" PhD (deadline 22 Nov) that run 1 missed. But
run 2's changed queries lost two ads run 1 had (UiS agent-based KI, NTNU Gjøvik sensor
fusion), so the doc below keeps all four arbeidsplassen queries.

## Intent doc

```markdown
# PhD and postdoc jobs in computer science and AI in Norway

## Reader

People looking for a PhD (stipendiat) or postdoc position in computer science, AI or machine learning at a Norwegian university or research institute, who want new openings before the deadline passes.

## Report

- New PhD, stipendiat, postdoc or researcher positions whose title or first paragraph names a computing topic: AI, machine learning, data science, computer vision, robotics, autonomous systems, cybersecurity, software engineering, distributed systems, HPC
- At Norwegian universities, university colleges, SINTEF, NORCE, Simula, NR and similar institutes
- Industrial PhD (nærings-ph.d.) positions, if the ad names the university

## Skip

- Positions where AI is only a tool for another field (psychiatry, dentistry, ecology, biology, linguistics). Test: would a computer science graduate be the natural hire? If not, skip.
- Professor, lecturer, engineer, "AI lead" and other industry jobs
- Ads whose deadline has passed
- Job-search tips, salary articles, university news

## Sources, check first

- https://arbeidsplassen.nav.no/stillinger?q=informatikk&published=now-7d&sort=published (NAV's job board, ads from the last 7 days; each ad shows employer, place, published date and "Søk senest")
- https://arbeidsplassen.nav.no/stillinger?q=stipendiat%20kunstig%20intelligens&published=now-7d&sort=published
- https://arbeidsplassen.nav.no/stillinger?q=PhD%20computer%20science&published=now-7d&sort=published
- https://arbeidsplassen.nav.no/stillinger?q=machine%20learning&published=now-7d&sort=published
- Each query catches ads the others miss; fetch all four. They also return off-field and industry ads: filter by title.
- https://www.simula.no/careers/job-openings (Simula's own list, often not on arbeidsplassen; deadlines only, no publish date)
- Ad links on arbeidsplassen are relative: prefix https://arbeidsplassen.nav.no.
- Traps: web search mostly returns closed ads from earlier rounds; check the deadline before using any search hit. jobbnorge.no search needs JavaScript; jobbnorge "joblisting/pdf" links are PDFs; EURAXESS and karrierestart block the fetch tool.

## Search terms

Use search only if the lists above fail: "stipendiat" informatikk søknadsfrist <next month year>; PhD research fellow informatics UiO <year>; NTNU IDI PhD candidate <year>

## Each story must state

- Title, employer and department, city
- Published date in backticks, and the deadline ("Søk senest") in backticks; write "deadline not given" if the ad has none
- PhD, postdoc or researcher, and the topic in one line
- Full link to the ad

One story per position. If more than 4 match, report the 4 with the nearest deadline and add the rest as one line each under the last story.

## No change

Report positions published in the last 7 days (for Simula: positions not in the last brief). If none, write "No new PhD or postdoc positions in computer science or AI since <date>." Don't pad with older ads.

## Language and place

Read Norwegian and English ads. Write in English. Norway, Europe/Oslo.
```

## Test notes

- Rejected sources: jobbnorge.no search and RSS (JavaScript / 403), jobbnorge
  "joblisting/pdf" (PDF), EURAXESS (fetch 403, curl fine), karrierestart and
  academicpositions (403), NTNU and UiO vacancy pages (jobbnorge widgets).
- arbeidsplassen's `education=Forskningsgrad` filter didn't remove industry ads, so it was
  dropped. Its `published=now-7d` makes each URL a ready-made saved search.
- Web search returns mostly closed ads from earlier rounds; the doc keeps it as a fallback.
- Run 2 brief: UiS "Stipendiat i fødererte blokkjedeteknologier" (published 19 Nov,
  deadline 10 Jan), UiS "livslang maskinlæring" (17 Nov, 15 Dec), Simula "PhD Scholarship in
  AI Agent Networking" (deadline 22 Nov), NORCE "Researchers – Drones and Autonomous
  Systems" (15 Nov, deadline not given); one line for Simula's quantum postdoc (25 Nov).
  It correctly left out the UiO psychiatry postdoc, Sensio "AI Lead" and HI benthic ecology.
