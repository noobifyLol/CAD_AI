# Phase 1B Preliminary Memo - 2024-2026 Only

Prepared: 2026-08-11

## Scope

This Phase 1B package repairs and extends the 2024-2026 preliminary LTL peer panel. It does not add or analyze 2021-2023 data.

The workbook output is:

`LTL_peer_panel_PHASE1B_2024_2026_completed.xlsx`

## What Was Completed

- Created a quarter completeness matrix for FedEx Freight, Old Dominion Freight Line, XPO North American LTL, and Saia.
- Populated 31 source-backed quarterly raw rows covering available 2024-2026 quarters in scope.
- Added normalized comparable fields without duplicating every raw/source field.
- Built a real data dictionary with definitions, units, source/derivation notes, and comparability notes.
- Added provenance at datapoint level with publication dates, source sections, exact reported metric labels, extraction method, and confidence.
- Added FedEx base-pricing fields. FedEx FY2026 Q4 only reports base revenue per CWT directionally as a slight decline, so the numeric field remains unresolved.
- Added 2025 Mastio national carrier ranking rows:
  - ODFL: 1 of 8
  - XPO: 4 of 8
  - Saia: 6 of 8
  - FedEx Freight: 7 of 8
- Added a manual verification sample of 20 datapoints.
- Exported CSV copies for raw quarterly rows, normalized quarterly rows, service annual rows, and provenance.

## Key Data Gaps

- FedEx Freight FY2024 Q3 through FY2025 Q4 quarter-level operating-stat tables remain unresolved.
- No full-quarter 2026 Q2 release rows were added for ODFL, XPO, or Saia; preliminary monthly updates were not promoted into quarterly panel rows.
- XPO 2024-2025 IR source pages are retained as URL-only because local HTML downloads timed out; XPO 2026 Q1 is downloaded from SEC.
- Mastio 2025 ODFL #1 is supported by an official ODFL/Mastio release; non-ODFL national rank rows are flagged as secondary public-summary support.
- Official 2024 Mastio national rank table was not retrieved.

## Verification

- Workbook opens successfully with the expected sheets.
- Quarterly raw rows: 31.
- Provenance rows: 546.
- Manual verification checks: 20.
- Blank provenance publication dates: 0.
- Placeholder exact metric labels: 0.

No thesis conclusions or 2021-2023 rows were added.
