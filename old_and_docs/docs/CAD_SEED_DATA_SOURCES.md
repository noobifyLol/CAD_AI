# CAD Seed Data Sources

This repo now has two editable CSV seed packs:

- `data/cadKnowledge.csv` for reusable CAD/modeling knowledge
- `data/cadPruningTable.csv` for routing/pruning rules that push prompts toward safer generation paths

## Online Sources Used

### Spur gear math
- Source: KHK Gears, "Calculation of Gear Dimensions"
- Link: https://khkgears.net/gear-knowledge/gear-technical-reference/calculation-gear-dimensions/
- Used for:
  - default 20 degree spur gear pressure angle
  - pitch/reference diameter from tooth count and module
  - base diameter = d * cos(alpha)
  - addendum = 1 * module
  - tooth depth = 2.25 * module
  - root diameter = d - 2.5 * module

### Timing pulley pitch geometry
- Source: SDP/SI, "Handbook of Timing Belts and Pulleys"
- Link: https://shop.sdp-si.com/products/synchronous-drive-belts-pulleys-cables/handbook-of-timing-belts-and-pulleys.html
- Used for:
  - pitch diameter driven by tooth pitch and tooth count
  - outside diameter being smaller than pitch diameter
  - simplified pulley modeling guidance for GT2 / HTD prompts

### Common robot bearing envelopes
- Source: REV Robotics, "ION Bearings"
- Link: https://www.revrobotics.com/ION-Bearings/
- Used for:
  - common flanged bearing outside diameters: 1.125 inch, 1.0 inch, 0.875 inch
  - common widths around 0.281 inch and 0.5 inch
  - bearing-block pocket sizing guidance

### Common robot structural tube envelopes
- Source: REV Robotics, "MAXTube - 2x1"
- Link: https://www.revrobotics.com/MAXTube-2x1/
- Used for:
  - 2 x 1 inch outer envelope
  - common wall thickness values around 0.04, 0.0625, 0.125, and 0.188 inch
  - structure-aware tube/channel seed knowledge

## App-Authored Tables

Some rows are not copied from one vendor source. They are project-authored modeling heuristics meant to improve first-pass generation quality:

- `Picture Frame Ring Profile`
- `Scissor Blade Pair Simplification`
- `Electronics Enclosure Shell Strategy`
- `Freeform Relief Simplification`
- all rows in `data/cadPruningTable.csv`

These are intentionally written as editable CAD guidance, not as manufacturing standards.

## How To Load The Data

- Full seed pass:
  - `npm run seed:knowledge`
- Knowledge CSV only:
  - `npm run import:cad-knowledge`
- Pruning table only:
  - `npm run import:cad-pruning`

`seed:knowledge` now merges:

- `data/cadKnowledge.json`
- `data/cadKnowledge.csv`
- `data/cadPruningTable.csv`

The pruning table is loaded into `cad_memory` only, while normal knowledge rows are loaded into both `cad_knowledge` and `cad_memory`.
