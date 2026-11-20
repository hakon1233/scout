# Bambu Lab firmware and policy changes (tested)

**Width:** stayed one brand. A Prusa or Creality release is noise to a Bambu owner, and
Bambu alone produced a cloud postmortem, a firmware beta, an app release and a service
notice in four weeks.

**Score:** run 1 5/6 → run 2 6/6. Both runs still **missed** the H2D 01.04.20.00 stable
firmware (3 Nov), which is why the checklist gained a Coverage point.

## Intent doc

```markdown
# Bambu Lab firmware and policy changes

## Reader

Owners of Bambu Lab printers (A1, P1, P2, X1, H2, H3, X2 series) who want to know what an update changes before they install it, and when Bambu changes how their printer connects.

## Report

- Firmware for any Bambu printer or AMS, stable or official public beta: version, models, what changes, security fixes, known issues
- Changes to authorization, LAN-only or developer mode, cloud service, Bambu Connect, or third-party access (Orca Slicer, Home Assistant)
- Bambu Studio or Bambu Handy releases that change printer control, firmware requirements, cloud or security
- Cloud outages and postmortems, data or privacy incidents
- Recalls, service notices, safety notices, warranty or terms changes
- A firmware problem only when Bambu staff confirm it or pull the update

## Skip

New printer, filament and accessory launches; sales; MakerWorld contests and merch; events; user stories; help threads; one user's report of a bad update; review sites.

## Sources, check first

- https://forum.bambulab.com/c/announcements/10.rss (official announcements, dated)
- https://forum.bambulab.com/c/bambu-lab-p/101.rss, https://forum.bambulab.com/c/bambu-lab-a-series/149.rss, https://forum.bambulab.com/c/bambu-lab-h2-series/166.rss (staff firmware posts by "SupportAssistant")
- https://github.com/bambulab/BambuStudio/releases

wiki.bambulab.com refuses the fetch tool; use its pages only through search snippets. Don't guess forum topic URLs; take them from the feeds.

## Search terms

Bambu Lab firmware public beta; Bambu Lab firmware release notes <model>; Bambu Lab cloud outage; Bambu Connect; Bambu Lab third-party access; Bambu Lab recall service notice

## Each story must state

- Models affected
- Firmware or app version, and stable or beta
- Release date (from the post, or the YYYYMMDD in a version heading)
- What changes for owners, and anything they must do first (e.g. bridge firmware)
- Link to Bambu's own post or release page

## No change

If nothing is new since the last brief, say "No firmware or policy changes since <date>." Don't pad with launches.

## Language and place

English sources and output. Worldwide, UTC.
```

## Test notes

- wiki.bambulab.com returns 402 to the fetch tool (curl loads it). blog.bambulab.com
  mirrors the forum announcements. bambulab.com/support/announcement returns 403.
- A guessed forum topic ID returned the wrong thread, hence "don't guess topic URLs".
- Run 2 brief: the 12 Nov cloud postmortem (traffic ~34-fold, partly from ha-bambulab),
  P1 firmware 01.10.00.15 public beta (needs bridge firmware 01.09.01.00 first), Bambu
  Studio 2.9.1, and the AMS 2 Pro service notice. One user's bad-update report was
  correctly left out.
