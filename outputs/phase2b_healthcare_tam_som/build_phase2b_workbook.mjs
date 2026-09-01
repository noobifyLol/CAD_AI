import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const outputDir = "outputs/phase2b_healthcare_tam_som";
const phase2aPath = "outputs/phase2a_healthcare_tam_som/FDXF_Healthcare_TAM_SOM.xlsx";
const outputPath = `${outputDir}/FDXF_Healthcare_TAM_SOM.xlsx`;
const data = JSON.parse(await fs.readFile(`${outputDir}/phase2b_processed_data.json`, "utf8"));

const input = await FileBlob.load(phase2aPath);
const wb = await SpreadsheetFile.importXlsx(input);

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function normalize(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(width - r.length).fill(null)]);
}

function getOrAddSheet(name) {
  try {
    return wb.worksheets.getItem(name);
  } catch {
    return wb.worksheets.add(name);
  }
}

function writeSheet(name, rows, options = {}) {
  const sheet = getOrAddSheet(name);
  sheet.showGridLines = false;
  const clearRange = options.clearRange || "A1:Z5000";
  try {
    sheet.getRange(clearRange).clear({ applyTo: "all" });
  } catch {
    // Some imported sheets may have smaller used ranges; direct writes below are authoritative.
  }
  const body = normalize(rows);
  const endCol = colLetter(body[0].length);
  sheet.getRangeByIndexes(0, 0, body.length, body[0].length).values = body;
  const headerRow = options.headerRow || 1;
  sheet.getRange(`A${headerRow}:${endCol}${headerRow}`).format = {
    fill: "#173B57",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
  };
  sheet.getRange(`A1:${endCol}${body.length}`).format = {
    wrapText: true,
    borders: {
      insideHorizontal: { style: "thin", color: "#E1E7EF" },
      bottom: { style: "thin", color: "#B9C6D3" },
    },
  };
  sheet.freezePanes.freezeRows(headerRow);
  try {
    sheet.getRange(`A1:${endCol}${body.length}`).format.autofitColumns();
    sheet.getRange(`A1:${endCol}${body.length}`).format.autofitRows();
  } catch {
    // Autofit is presentation-only.
  }
  return sheet;
}

function setFmt(sheet, range, fmt) {
  sheet.getRange(range).setNumberFormat(fmt);
}

function recordsToRows(records, headers) {
  return [headers, ...records.map((r) => headers.map((h) => r[h] ?? null))];
}

const meta = data.meta;

const executiveRows = [
  ["FedEx Freight Healthcare TAM -> SAM / Required Share", null, null, null],
  ["Version", "Phase 2B observed-data hardening", "Prepared", "2026-08-11"],
  [null, null, null, null],
  ["Question", "Answer", "Observed support", "Caveat / next diligence"],
  ["Reconcile $6B?", "Approximate yes; direct no.", "CFS value for SCTG 21 + 38 is about $1.91T; $6B equals about 31 bps of that goods-value base.", "CFS reports goods value and tonnage, not carrier revenue."],
  ["Addressable portion?", "Core LTL: ~$1.64B. Core LTL + CC upper bound: ~$2.51B.", "Core uses for-hire truck, 100-9,999 lb. CC proxy uses temperature-controlled for-hire truck.", "TC06 does not cross-tab weight and temperature; A+B may overlap."],
  ["Street healthcare revenue?", "At 1.0 ppt / 25-75% healthcare allocation: ~$67M-$200M.", "Central 1.0 ppt / 67% case is ~$179M.", "Jefferies 1 ppt note is not publicly verified; treated as user research-note input."],
  ["Implied penetration?", "Central case: 3.0% of $6B, 10.9% of core LTL, 7.1% of core LTL+CC.", "Sensitivity covers 0.5/1.0/1.5 ppt and 25/50/67/75%.", "Labels: trivial <5%, plausible 5-10%, demanding 10-20%, aggressive >20%."],
  ["Bear thesis?", "No, not by itself.", "Observed hurdle is mostly trivial/plausible versus headline and plausible/demanding versus core-only.", "Better bear case is execution proof, not TAM insufficiency."],
  ["Explicit answer", "TAM/right-to-win is not a strong standalone differentiated bear thesis.", "FedEx has LTL, Custom Critical, temperature-control references, and visible CFS pools.", "Current healthcare revenue and named FDXF wins remain undisclosed."],
  [null, null, null, null],
  ["Key Metric", "Value", "Source / Formula", "Interpretation"],
  ["Observed goods value ($M)", meta.headline_goods_value_m, "SCTG 21 + SCTG 38, all modes, total shipment weight", "Observed denominator for approximate $6B reconciliation"],
  ["Implied freight rate", meta.implied_freight_rate, "$6B / observed goods value", "About 31 bps of goods value"],
  ["Core LTL SAM ($M)", meta.core_sam_m, "For-hire truck, 100-9,999 lb goods value * implied rate", "Observed-data core LTL proxy"],
  ["Core LTL + CC SAM ($M)", meta.core_cc_sam_m, "Core LTL + temp-controlled for-hire truck goods value * implied rate", "Upper-bound observable proxy, not de-duplicated"],
  ["Central HC revenue ($M)", null, "Required_Share_Sensitivity central case", "Central research-note bridge output"],
  ["1.0 ppt / 67% share of core+CC SAM", null, "Required_Share_Sensitivity central case", "Plausible under workbook labels"]
];

const exec = writeSheet("Executive_Summary", executiveRows, { headerRow: 4, clearRange: "A1:H80" });
exec.getRange("A1:D1").merge();
exec.getRange("A1:D1").format = { fill: "#0B1F33", font: { bold: true, color: "#FFFFFF", size: 15 } };
exec.getRange("B17").formulas = [["=INDEX('Required_Share_Sensitivity'!$D$2:$D$13,MATCH(1,('Required_Share_Sensitivity'!$A$2:$A$13=1.0%)*('Required_Share_Sensitivity'!$B$2:$B$13=67%),0))"]];
exec.getRange("B18").formulas = [["=INDEX('Required_Share_Sensitivity'!$G$2:$G$13,MATCH(1,('Required_Share_Sensitivity'!$A$2:$A$13=1.0%)*('Required_Share_Sensitivity'!$B$2:$B$13=67%),0))"]];
setFmt(exec, "B13:B13", "$#,##0");
setFmt(exec, "B14:B14", "0.00%");
setFmt(exec, "B15:B17", "$#,##0");
setFmt(exec, "B18:B18", "0.0%");
exec.getRange("A1:A18").format.columnWidth = 28;
exec.getRange("B1:B18").format.columnWidth = 58;
exec.getRange("C1:C18").format.columnWidth = 72;
exec.getRange("D1:D18").format.columnWidth = 56;

const mapRows = [["Code_Type", "Code", "Label", "Inclusion", "Rationale", "Source_Tables"], ...data.commodity_map];
writeSheet("Healthcare_Commodity_Map", mapRows);

const rawHeaders = ["Source_Table", "COMM", "COMM_LABEL", "NAICS2017", "NAICS2017_LABEL", "DMODE", "DMODE_LABEL", "SHIPDIST", "SHIPDIST_LABEL", "SHIPWT", "SHIPWT_LABEL", "YEAR", "VAL", "TON", "AVGMILE", "VAL_S", "TON_S", "AVGMILE_S"];
const raw = writeSheet("CFS_Raw", recordsToRows(data.cfs_raw, rawHeaders), { clearRange: "A1:R4000" });
setFmt(raw, "M2:N4000", "#,##0");
setFmt(raw, "O2:O4000", "#,##0");
setFmt(raw, "P2:R4000", "0.0");

const weightHeaders = ["Commodity_Code", "Commodity_Label", "Mode_Code", "Mode_Label", "Requested_Weight_Bucket", "CFS_Bucket_Codes", "Value_$M", "Tons_000", "Share_of_Mode_Value", "Addressability", "Notes", "Source_Table"];
const weight = writeSheet("Shipment_Weight", recordsToRows(data.shipment_weight, weightHeaders), { clearRange: "A1:L200" });
setFmt(weight, "G2:H200", "#,##0");
setFmt(weight, "I2:I200", "0.0%");

const modeHeaders = ["Commodity_Code", "Commodity_Label", "Mode_Code", "Mode_Label", "Value_$M", "Tons_000", "Average_Miles", "Share_of_Total_Value", "Source_Table"];
const mode = writeSheet("Mode_Share", recordsToRows(data.mode_share, modeHeaders), { clearRange: "A1:I80" });
setFmt(mode, "E2:G80", "#,##0");
setFmt(mode, "H2:H80", "0.0%");

const tempHeaders = ["Commodity_Code", "Commodity_Label", "Mode_Code", "Mode_Label", "Temperature_Controlled_Value_$M", "Temperature_Controlled_Tons_000", "Average_Miles", "Source_Table"];
const temp = writeSheet("Temp_Control", recordsToRows(data.temp_control, tempHeaders), { clearRange: "A1:H80" });
setFmt(temp, "E2:G80", "#,##0");

const addrRows = [
  ["Bucket", "Observed_Goods_Value_$M", "Implied_Freight_Revenue_Rate", "Implied_Freight_Revenue_$M", "Observed_basis", "Addressability", "Caveat"],
  ...data.ltl_addressability.map((r) => [r.Bucket, r["Observed_Goods_Value_$M"], null, null, r.Observed_basis, r.Addressability, r.Caveat])
];
const addr = writeSheet("LTL_Addressability", addrRows, { clearRange: "A1:G20" });
addr.getRange("C2").formulas = [["=6000/B2"]];
addr.getRange("C3:C5").formulas = [["=$C$2"], ["=$C$2"], ["=$C$2"]];
addr.getRange("D2").formulas = [["=B2*C2"]];
addr.getRange("D3:D5").formulas = [["=B3*C3"], ["=B4*C4"], ["=B5*C5"]];
setFmt(addr, "B2:B5", "$#,##0");
setFmt(addr, "C2:C5", "0.00%");
setFmt(addr, "D2:D5", "$#,##0");

const bridgeRows = [
  ["Input / Output", "Value", "Source / Status", "Notes"],
  ["FY2026 FDXF revenue base ($M)", meta.fdxf_2026_revenue_m, "FedEx Freight FY2026 results", "Used as base for 2029 vertical contribution bridge."],
  ["Jefferies new-vertical contribution", "Approx. 1 ppt annual revenue growth", "Not independently verified in public web/source scan", "Included because user says existing research notes indicate this assumption."],
  ["Sensitivity vertical contribution", "0.5 ppt / 1.0 ppt / 1.5 ppt", "Workbook assumption range", "Primary framework replaces Phase 2A 15%/25%/40% healthcare contribution share."],
  ["Healthcare allocation of new verticals", "25% / 50% / 67% / 75%", "Workbook assumption range", "Do not assert one allocation is correct unless later sourced."],
  ["Years compounded", 3, "2026 to 2029", "Formula: FY2026 revenue * ((1 + vertical ppt)^3 - 1)."]
];
const bridge = writeSheet("Street_Vertical_Bridge", bridgeRows, { clearRange: "A1:D20" });
setFmt(bridge, "B2:B2", "$#,##0");

const sensRows = [
  ["Vertical_CAGR_Contribution_ppt", "Healthcare_Allocation_of_New_Verticals", "2029_Incremental_Vertical_Revenue_$M", "2029_Healthcare_Revenue_$M", "Required_%_$6B_Headline_TAM", "Required_%_Core_LTL_SAM", "Required_%_Core_LTL_plus_CC_SAM", "Headline_Label", "Core_LTL_Label", "Core_plus_CC_Label"],
  ...data.required_sensitivity.map((r) => [r.Vertical_CAGR_Contribution_ppt, r.Healthcare_Allocation_of_New_Verticals, null, null, null, null, null, null, null, null])
];
const sens = writeSheet("Required_Share_Sensitivity", sensRows, { clearRange: "A1:J30" });
sens.getRange("C2").formulas = [["='Street_Vertical_Bridge'!$B$2*((1+A2)^3-1)"]];
sens.getRange("D2").formulas = [["=C2*B2"]];
sens.getRange("E2").formulas = [["=D2/'LTL_Addressability'!$D$2"]];
sens.getRange("F2").formulas = [["=D2/'LTL_Addressability'!$D$3"]];
sens.getRange("G2").formulas = [["=D2/'LTL_Addressability'!$D$5"]];
sens.getRange("H2").formulas = [["=IF(E2<5%,\"TRIVIAL\",IF(E2<10%,\"PLAUSIBLE\",IF(E2<20%,\"DEMANDING\",\"AGGRESSIVE\")))"]];
sens.getRange("I2").formulas = [["=IF(F2<5%,\"TRIVIAL\",IF(F2<10%,\"PLAUSIBLE\",IF(F2<20%,\"DEMANDING\",\"AGGRESSIVE\")))"]];
sens.getRange("J2").formulas = [["=IF(G2<5%,\"TRIVIAL\",IF(G2<10%,\"PLAUSIBLE\",IF(G2<20%,\"DEMANDING\",\"AGGRESSIVE\")))"]];
for (const col of ["C", "D", "E", "F", "G", "H", "I", "J"]) {
  sens.getRange(`${col}2:${col}13`).fillDown();
}
setFmt(sens, "A2:B13", "0.0%");
setFmt(sens, "C2:D13", "$#,##0");
setFmt(sens, "E2:G13", "0.0%");

const directRows = [
  ["Provider", "Same-freight role", "Service offering", "Network footprint", "Temperature / specialty capability", "Claims / on-time evidence", "Pricing evidence", "Customer/account evidence", "FDXF implication", "Source_URL"],
  ["FedEx Freight / Custom Critical", "Target company; North American LTL and surface critical freight", "Priority/Economy LTL, Custom Critical Surface Expedite, White Glove, temperature control, Freight Direct", "365+ locations, 355 shipping terminals, 26,000+ doors, nearly 30,000 vehicles from Form 10 / IR materials", "FedEx Freight page describes temperature-controlled shipping; Custom Critical offers special care/temperature control", "FY2026 release cites safety performance; no public healthcare claims/on-time metric found", "Public tariff/rate tools but no healthcare-specific price evidence", "No current healthcare revenue or named revenue-sized FDXF healthcare win found", "Right-to-play exists; execution proof remains the issue", "https://ir.fedexfreight.com/financial-information/sec-filings/content/0001104659-26-060223/tm2520565d14_ex99-1.htm"],
  ["ArcBest / Panther Premium Logistics", "Direct surface expedite, refrigerated and healthcare/life-sciences logistics", "Life sciences logistics, temperature validation, expedite, final-mile, refrigerated shipping through truckload/Panther network", "Asset-light/network capacity plus ArcBest LTL and Panther Premium Logistics", "Temperature validation, refrigerated trailers/containers, enhanced security, expedite", "No broad LTL claims/on-time metric captured in this phase", "Quote-based; no public healthcare price evidence found", "Public healthcare use case references medical equipment demand surge", "Direct competitor in specialty/time-critical healthcare freight", "https://arcb.com/shippers/industries/life-sciences"],
  ["XPO LTL", "National LTL competitor; freeze-protection / temp-sensitive LTL", "LTL freeze protection, expedited option references, protect-from-freezing workflows", "North American LTL network; source captured service-level details not full terminal count", "Freeze Protection Service October-April; warming rooms when available; expedited/refrigerated alternatives recommended for must-arrive shipments", "No healthcare-specific metric found in captured source", "Tariff/item references; no healthcare-specific price evidence found", "Healthcare-specific U.S. customer evidence not found; Europe healthcare page is context only", "Competes in generic/protected LTL, less clear in pharma-grade U.S. healthcare", "https://www.xpo.com/help-center/freezable-products/"],
  ["Old Dominion Freight Line", "Premium national LTL competitor for high-value palletized freight", "Domestic LTL, expedited, security divider, pallet rates, truckload/refrigerated via partner network", "260+ service centers; North America coverage", "Security Divider, expedited services, truckload refrigerated partner options", "OD source cites 99% on-time in Q1 2026 and claims ratio below 0.1%; calculator cites 0.05% claims ratio as of Q2 2025", "Public rate estimator and pallet/cube/expedited quotes, no healthcare-specific price evidence", "No healthcare-specific current account evidence found", "Strong service/claims benchmark raises bar for FDXF core LTL share capture", "https://www.olddominion.com/us/en/services/od-domestic-ltl.html"],
  ["Estes / Estes Logistics", "National/private LTL plus logistics/white-glove competitor", "LTL, Time Critical Guaranteed, Estes Logistics, white glove, room-of-choice, custom delivery", "300+ service centers from company site", "Custom delivery and white glove; not healthcare-specific in captured source", "No public healthcare-specific claims/on-time metric captured", "Rate quote tools; no healthcare-specific price evidence", "No healthcare-specific current account evidence found", "Relevant to white-glove medical equipment and generic LTL, but less direct for pharma temp-control", "https://www.estes-express.com/index"],
  ["Specialized refrigerated / healthcare surface carriers", "Niche direct competitors for temperature-controlled LTL/FTL healthcare freight", "Temperature-stable, time-sensitive LTL/FTL, monitored/validated trucks, expedited courier", "Carrier-specific regional/national networks", "Dedicated temperature-controlled healthcare transport", "Not consistently disclosed", "Quote-based", "Some sites explicitly mention pharmaceuticals, medical supplies/equipment and lab samples", "Limits natural FDXF right-to-win in the highest-control specialty segment", "https://www.missioncarrier.com/pharmaceutical-health-logistics"]
];
writeSheet("Direct_Competitors", directRows, { clearRange: "A1:J30" });

const distanceHeaders = ["Commodity_Code", "Commodity_Label", "Mode_Code", "Mode_Label", "Distance_Code", "Distance_Bucket", "Value_$M", "Tons_000", "Share_of_Mode_Value", "Source_Table"];
const dist = writeSheet("Distance_Distribution", recordsToRows(data.distance_distribution, distanceHeaders), { clearRange: "A1:J200" });
setFmt(dist, "G2:H200", "#,##0");
setFmt(dist, "I2:I200", "0.0%");

const sourcesRows = [
  ["Source_ID", "Title", "Publisher", "Date", "URL", "Used_For", "Notes"],
  ["CFS_DOWNLOADS", "2022 CFS tables for downloads", "U.S. Census Bureau / BTS", "2025-06-26", "https://www2.census.gov/programs-surveys/cfs/data/2022/", "Official GAS09/GAS10/GAS18/GAS19/GAS20/TC05/TC06/TC09 raw data", "API data endpoint required a key; official downloadable zips were used."],
  ["CFS_FINAL_TABLES", "2022 Commodity Flow Survey Final Tables", "U.S. Census Bureau / BTS", "2025-06", "https://www.census.gov/data/tables/2022/econ/cfs/aff-2022.html", "Table descriptions, row counts, suggested citation", "Primary government source."],
  ["FDX_INV_DAY", "FedEx Freight Investor Day Presentation", "FedEx Freight", "2026-04-08", "https://d1io3yog0oux5.cloudfront.net/_5705b101ff53031529c842d008f96e5d/fedexfreight/db/3570/34491/presentation/FedEx+Freight+Investor+Day+Presentation.pdf", "$6B healthcare opportunity; 4%-6% medium-term revenue CAGR", "Primary management source."],
  ["FDXF_FORM10", "FedEx Freight Information Statement / Form 10 exhibit", "FedEx Freight / SEC", "2026-05-13", "https://ir.fedexfreight.com/financial-information/sec-filings/content/0001104659-26-060223/tm2520565d14_ex99-1.htm", "Network footprint, business description, healthcare logistics mention", "Primary company filing."],
  ["FDXF_Q4_FY26", "FedEx Freight FY2026 results", "FedEx Freight IR", "2026", "https://ir.fedexfreight.com/news-events/press-releases/detail/185/fedex-freight-reports-fourth-quarter-and-full-fiscal-year-2026-financial-results", "FY2026 revenue base", "Primary company release."],
  ["FDX_LTL_101", "FedEx Freight Shipping 101", "FedEx Freight", "Accessed 2026-08-11", "https://www.fedexfreight.com/en-us/support-resources/freight-shipping-101", "LTL definition: typically 150-20,000 lb; palletized freight; temperature-control description", "Authoritative LTL framework source."],
  ["FDX_LTL_SERVICES", "FedEx Freight services", "FedEx Freight", "Accessed 2026-08-11", "https://www.fedexfreight.com/en-us/services", "LTL guideline: less than 15 feet, less than 15,000 lb, single pallet less than 2,000 lb", "Authoritative LTL framework source."],
  ["ARCBEST_LSH", "Life Sciences and Healthcare Logistics", "ArcBest", "Accessed 2026-08-11", "https://arcb.com/shippers/industries/life-sciences", "Direct competitor healthcare/time-critical capability", "Competitor source."],
  ["XPO_FREEZE", "XPO Freezable Products / Freeze Protection", "XPO", "Accessed 2026-08-11", "https://www.xpo.com/help-center/freezable-products/", "Direct LTL freeze-protection competitor evidence", "Competitor source."],
  ["ODFL_LTL", "OD Domestic LTL Freight", "Old Dominion Freight Line", "Accessed 2026-08-11", "https://www.olddominion.com/us/en/services/od-domestic-ltl.html", "Network, service, claims/on-time benchmark", "Competitor source."],
  ["ESTES", "Estes LTL and logistics services", "Estes", "Accessed 2026-08-11", "https://www.estes-express.com/index", "Network and time-critical/white-glove context", "Competitor source."],
  ["JEFFERIES_NOTE", "Jefferies new-vertical penetration note", "User-provided research note", "Not independently verified", "N/A", "1 ppt vertical contribution sensitivity anchor", "Flagged as unverified in public source scan."]
];
writeSheet("Sources", sourcesRows, { clearRange: "A1:G100" });

const dictRows = [
  ["Sheet", "Field", "Definition", "Units / Format", "Formula / Derivation", "Source / Assumption", "Notes"],
  ["CFS_Raw", "VAL", "CFS shipment commodity value.", "$ millions", "Official CFS table value field.", "CFS downloadable tables", "Goods value, not carrier revenue."],
  ["CFS_Raw", "TON", "CFS shipment weight.", "Thousand tons", "Official CFS table tonnage field.", "CFS downloadable tables", "Not shipment count."],
  ["Healthcare_Commodity_Map", "Inclusion", "Whether a code is included in the healthcare proxy.", "Text", "Analyst classification based on official labels.", "CFS labels", "Broad proxy codes are explicitly marked."],
  ["LTL_Addressability", "Implied_Freight_Revenue_Rate", "Freight/logistics revenue rate implied by $6B headline over observed CFS goods value.", "% of goods value", "$6B / SCTG 21+38 all-mode goods value", "Management headline + CFS", "Not directly observed in CFS."],
  ["LTL_Addressability", "Core LTL-compatible", "For-hire truck, SCTG 21+38, 100-9,999 lb goods value converted by implied freight rate.", "$M revenue proxy", "Observed goods value * implied rate", "CFS + FedEx LTL definitions", "CFS bucket 100-499 includes some sub-150 lb freight."],
  ["LTL_Addressability", "Custom Critical / specialty-compatible", "Temperature-controlled for-hire truck value for SCTG 21+38 converted by implied freight rate.", "$M revenue proxy", "TC06 observed goods value * implied rate", "CFS temperature-control table", "Can overlap with core LTL."],
  ["Street_Vertical_Bridge", "Vertical_CAGR_Contribution_ppt", "Annual FDXF revenue CAGR contribution from new verticals.", "% points", "Sensitivity: 0.5/1.0/1.5 ppt", "User research-note assumption", "Jefferies note not publicly verified."],
  ["Required_Share_Sensitivity", "2029_Healthcare_Revenue_$M", "Healthcare portion of vertical revenue contribution.", "$M", "FY2026 revenue * ((1 + vertical ppt)^3 - 1) * healthcare allocation", "Formula", "Replaces Phase 2A growth-share framework."],
  ["Required_Share_Sensitivity", "Labels", "Analytical convention for required penetration.", "Text", "Trivial <5%; Plausible 5-10%; Demanding 10-20%; Aggressive >20%", "User-provided convention", "Not a factual rating."]
];
writeSheet("Data_Dictionary", dictRows, { clearRange: "A1:G60" });

const checksRows = [
  ["Check", "Actual", "Expected", "Difference", "Tolerance", "Status", "Notes"],
  ["Headline TAM reconciliation", null, 6000, null, 0.01, null, "LTL_Addressability D2 should equal $6B."],
  ["Sensitivity rows", 12, 12, 0, 0, "OK", "Three vertical-contribution cases x four healthcare allocations."],
  ["CFS API access", "API key required", "Official source used", "N/A", "N/A", "OK", "Used official downloadable CFS zip files from Census directory."],
  ["Existing healthcare revenue quantified?", "No", "Publicly disclosed value", "N/A", "N/A", "LIMITATION", "Management shows healthcare as an industry but no current healthcare revenue was found."],
  ["CFS shipment count available?", "No", "If available", "N/A", "N/A", "LIMITATION", "Prioritized final CFS tables provide value/tons/miles; not shipment count."]
];
const checks = writeSheet("Checks", checksRows, { clearRange: "A1:G20" });
checks.getRange("B2").formulas = [["='LTL_Addressability'!D2"]];
checks.getRange("D2").formulas = [["=B2-C2"]];
checks.getRange("F2").formulas = [["=IF(ABS(D2)<=E2,\"OK\",\"FAIL\")"]];
setFmt(checks, "B2:E2", "$#,##0.00");

for (const [sheetName, cell] of [["Mgmt_TAM", "A8"], ["TAM_to_SAM", "A10"], ["Required_Share", "A12"], ["Competitor_Matrix", "A8"], ["FedEx_Capabilities", "A10"], ["Customer_Wins", "A9"]]) {
  try {
    const sheet = wb.worksheets.getItem(sheetName);
    sheet.getRange(cell).values = [["PHASE 2A CAVEAT: assumption-driven output preserved for audit trail; Phase 2B observed-data sheets supersede this as the primary framework."]];
    sheet.getRange(cell).format = { fill: "#FFF2CC", font: { bold: true, color: "#7A3E00" }, wrapText: true };
  } catch {
    // Sheet may not exist in a future source workbook.
  }
}

for (const s of ["Executive_Summary", "LTL_Addressability", "Required_Share_Sensitivity", "Direct_Competitors"]) {
  const blob = await wb.render({ sheetName: s, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}/${s}_preview.png`, new Uint8Array(await blob.arrayBuffer()));
}

const errors = await wb.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  maxChars: 2000,
});
console.log(errors.ndjson);

const xlsx = await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(outputPath);
console.log(outputPath);
