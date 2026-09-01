import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outDir = path.resolve("outputs/phase1_ltl_peer_panel");
const sourcesDir = path.join(outDir, "sources");
const workbookPath = path.join(outDir, "LTL_peer_panel_PHASE1_2024_2026_preliminary.xlsx");

const qHeaders = [
  "observation_id","carrier","ticker","period_start_date","period_end_date","calendar_year","calendar_quarter",
  "fiscal_year_reported","fiscal_quarter_reported","operating_days","reporting_basis","revenue_m",
  "operating_income_m","adjusted_operating_income_m","operating_margin_pct","adjusted_operating_margin_pct",
  "operating_ratio_pct","adjusted_operating_ratio_pct","avg_daily_shipments","shipments_yoy_pct",
  "tonnage_per_day","tonnage_yoy_pct","weight_per_shipment_lbs","weight_per_shipment_yoy_pct",
  "revenue_per_shipment","revenue_per_shipment_yoy_pct","revenue_per_shipment_ex_fuel",
  "revenue_per_shipment_ex_fuel_yoy_pct","revenue_per_cwt","revenue_per_cwt_yoy_pct",
  "revenue_per_cwt_ex_fuel","revenue_per_cwt_ex_fuel_yoy_pct","yield_reported","yield_ex_fuel_reported",
  "fuel_surcharge_revenue_m","fuel_surcharge_pct_revenue","comparability","comparability_note","source_url","local_source_file","source_status"
];

const rows = [
  ["FDXF_FY2026_Q4","FedEx Freight","FDXF","2026-03-01","2026-05-31",2026,"Q2",2026,"Q4",null,"FedEx Freight segment as reported by FedEx Corp; not carve-out basis",2400,158,363,0.066,0.151,null,null,86700,-0.059,null,null,948,0.03,415.22,0.115,null,null,43.79,0.082,null,null,null,null,null,null,"PARTIAL","FedEx fiscal quarter ending May 31; includes fuel for revenue/shipment and revenue/cwt; peer comparability requires basis review.","https://ir.fedexfreight.com/news-events/press-releases/detail/185/fedex-freight-reports-fourth-quarter-and-full-fiscal-year-2026-financial-results","FDXF_2026_Q4_earnings_release.html","Downloaded"],
  ["ODFL_CY2026_Q1","Old Dominion Freight Line","ODFL","2026-01-01","2026-03-31",2026,"Q1",2026,"Q1",63,"Reported company LTL statistics / GAAP operating ratio",null,null,null,null,null,0.762,null,41037,-0.079,30584,-0.077,1491,0.003,514.56,0.059,434.16,0.047,34.52,0.057,29.13,0.044,null,null,null,null,"HIGH","Calendar quarter; ODFL provides absolute operating statistics and ex-fuel pricing metrics.","https://ir.odfl.com/news-events/press-releases/detail/342/old-dominion-freight-line-reports-first-quarter-2026","ODFL_2026_Q1_earnings_release.html","Downloaded"],
  ["XPO_CY2026_Q1","XPO North American LTL","XPO","2026-01-01","2026-03-31",2026,"Q1",2026,"Q1",null,"North American LTL segment",1230,189,198,null,null,null,0.839,null,0.03,null,0.001,null,null,null,null,null,null,null,null,null,0.04,null,0.04,null,null,"PARTIAL","XPO release reports segment revenue/income plus YoY shipment, tonnage, and yield changes; absolute shipment/tonnage not in captured release snippet.","https://investors.xpo.com/news-releases/news-release-details/xpo-reports-first-quarter-2026-results","XPO_2026_Q1_earnings_release.html","Identified, download timed out"],
  ["SAIA_CY2026_Q1","Saia","SAIA","2026-01-01","2026-03-31",2026,"Q1",2026,"Q1",63,"GAAP company LTL operating statistics",806.2,66.8,null,null,null,0.917,null,34790,0.01,24020,-0.021,1380,null,null,null,null,-0.012,25.93,0.038,21.52,0.019,null,null,null,null,"HIGH","Calendar quarter; LTL stats exclude transportation/logistics services where pricing is not generally determined by weight.","https://www.sec.gov/Archives/edgar/data/1177702/000119312526194062/saia-ex99_1.htm","SAIA_2026_Q1_SEC_8K_ex99_1.htm","Downloaded"],
  ["SAIA_CY2025_Q2","Saia","SAIA","2025-04-01","2025-06-30",2025,"Q2",2025,"Q2",64,"GAAP company LTL operating statistics",817.1,99.4,null,null,null,0.878,null,35330,-0.028,24630,0.011,1394,0.04,351.36,0.018,298.71,0.027,25.20,-0.021,21.42,-0.012,null,null,null,null,"HIGH","Downloaded SEC exhibit includes financial and operating table for Q2 2025 and prior-year comparison.","https://www.sec.gov/Archives/edgar/data/1177702/000095017025098577/saia-ex99_1.htm","SAIA_2025_Q2_SEC_8K_ex99_1.htm","Downloaded"],
  ["XPO_CY2025_Q2","XPO North American LTL","XPO","2025-04-01","2025-06-30",2025,"Q2",2025,"Q2",null,"North American LTL segment",1240,199,211,null,null,null,0.829,null,-0.051,null,-0.067,null,null,null,0.056,null,null,null,null,null,null,0.042,0.061,null,null,"PARTIAL","Release reports segment financials and YoY operating/yield changes; absolute shipment/tonnage not captured in first pass.","https://investors.xpo.com/news-releases/news-release-details/xpo-reports-second-quarter-2025-results","XPO_2025_Q2_earnings_release.html","Identified, download timed out"]
];

const dictRows = qHeaders.map(h => [h, {
  observation_id:"Unique row key: carrier + reported period.",
  carrier:"Business unit/carrier name.",
  ticker:"Public ticker used in the study.",
  period_start_date:"Actual reported period start date where known.",
  period_end_date:"Actual reported period end date.",
  calendar_year:"Calendar year of period end.",
  calendar_quarter:"Calendar quarter of period end.",
  fiscal_year_reported:"Company-reported fiscal year.",
  fiscal_quarter_reported:"Company-reported fiscal quarter.",
  operating_days:"Company-reported workdays/operating days.",
  reporting_basis:"Basis caveat: segment, standalone/recast, GAAP, adjusted, etc.",
  comparability:"HIGH, PARTIAL, or NOT_COMPARABLE based on current source review.",
  source_status:"Downloaded, identified, unavailable, or pending."
}[h] || "Requested operating, financial, yield, service, network, or sourcing field. Percent fields stored as decimal values."]);

const serviceHeaders = ["carrier","year","mastio_rank","mastio_rank_denominator","mastio_percentile","mastio_overall_rank","mastio_national_carrier_rank","mastio_overall_weighted_quality_score","on_time_service_pct","cargo_claims_ratio_pct","damage_claims_ratio_pct","service_metric_definition","source_url","source_status","notes"];
const serviceRows = [
  ["FedEx Freight",2024,null,null,null,null,null,null,null,null,null,null,null,"Gap","Mastio/source documents not yet downloaded in Phase 1 first pass."],
  ["Old Dominion Freight Line",2024,null,null,null,null,null,null,null,null,null,null,null,"Gap",""],
  ["XPO North American LTL",2024,null,null,null,null,null,null,null,null,null,null,null,"Gap",""],
  ["Saia",2024,null,null,null,null,null,null,null,null,null,null,null,"Gap",""],
  ["FedEx Freight",2025,null,null,null,null,null,null,null,null,null,null,null,"Gap",""],
  ["Old Dominion Freight Line",2025,null,null,null,null,null,null,null,null,null,null,null,"Gap",""],
  ["XPO North American LTL",2025,null,null,null,null,null,null,null,null,null,null,null,"Gap",""],
  ["Saia",2025,null,null,null,null,null,null,null,null,0.005,"First-quarter claims ratio; definition needs confirmation before peer comparison.","https://www.sec.gov/Archives/edgar/data/1177702/000119312526194062/saia-ex99_1.htm","Downloaded","This is a 2026 Q1 company-reported claims ratio, not Mastio."],
];

const provHeaders = ["observation_id","carrier","metric_name","metric_value","unit","period","source_type","source_title","source_url","source_publication_date","source_page_or_section","exact_reported_metric_label","reported_or_derived","derivation_formula","notes"];
const provRows = [];
for (const r of rows) {
  const obj = Object.fromEntries(qHeaders.map((h,i)=>[h,r[i]]));
  for (const metric of ["revenue_m","operating_income_m","adjusted_operating_income_m","operating_ratio_pct","avg_daily_shipments","shipments_yoy_pct","tonnage_per_day","tonnage_yoy_pct","weight_per_shipment_lbs","revenue_per_shipment","revenue_per_cwt","revenue_per_cwt_ex_fuel","yield_ex_fuel_reported"]) {
    if (obj[metric] !== null && obj[metric] !== "") provRows.push([obj.observation_id,obj.carrier,metric,obj[metric],metric.includes("pct")||metric.includes("ratio")||metric.includes("yield")?"decimal":(metric.includes("revenue")||metric.includes("income")?"USD / $m as named":"count or lbs"),`${obj.calendar_year} ${obj.calendar_quarter}`,"Primary company / SEC source","Phase 1 captured release",obj.source_url,"See source","Press release / operating statistics",metric,"REPORTED","","First pass; verify section/page during full extraction."]);
  }
}

const gaps = [
  ["Area","Gap","Priority","Next step"],
  ["Downloads","XPO 2026 Q1 and 2025 Q2 identified but local download timed out","High","Retry using company PDF links or SEC exhibits."],
  ["2024 coverage","No 2024 rows populated yet in first pass","High","Download 2024 annual/Q releases before backward expansion."],
  ["Mastio","2024-2025 Mastio public tables/rank denominator not populated","High","Locate official Mastio releases/methodology only; preserve denominator."],
  ["FedEx","Need FY2024-FY2026 stat books for all quarterly details and fiscal/calendar alignment","High","Use FedEx IR stat book PDFs/XLSX and FedEx Freight investor materials."],
  ["ODFL/XPO/SAIA","Need complete 2024-2026 quarter releases and 10-Q/10-K cross-checks","High","Batch download by quarter, then extract operating-statistics tables."],
  ["Service KPIs","On-time and claims definitions mostly blank","Medium","Only populate if company or Mastio source discloses definition."]
];

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString().slice(0,10) : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
}
async function writeCsv(name, headers, data) {
  await fs.writeFile(path.join(outDir, name), [headers, ...data].map(row => row.map(csvEscape).join(",")).join("\n"));
}

const wb = Workbook.create();
const tabs = [
  ["README", [["Phase 1 preliminary workbook"],["Scope: primary source identification/downloads, data dictionary, and initial 2024-2026 population only."],["Status: do not proceed to 2021-2023 until this workbook and gaps are reviewed."]]],
  ["Quarterly_Raw", [qHeaders, ...rows]],
  ["Quarterly_Normalized", [qHeaders, ...rows.map(r => r.map((v,i)=>v))]],
  ["Service_Annual", [serviceHeaders, ...serviceRows]],
  ["Network_Annual", [["carrier","year","service_center_count","door_count","tractor_count","trailer_count","employee_count","driver_count","capex_m","source_url","source_status","notes"]]],
  ["Provenance", [provHeaders, ...provRows]],
  ["Data_Dictionary", [["field_name","definition"], ...dictRows]],
  ["Validation_Flags", gaps],
  ["Analysis", [["Preliminary Readout"],["The dataset is intentionally sparse. Current evidence is not enough for investment conclusion or 2021-2023 expansion."],["Populated rows by carrier"],["FedEx Freight",1],["ODFL",1],["XPO",2],["Saia",2]]],
  ["Charts", [["Charts intentionally deferred"],["Need fuller 2024-2026 coverage before plotting trends without misleading sparsity."]]],
];

for (const [name, data] of tabs) {
  const ws = wb.worksheets.add(name);
  ws.showGridLines = false;
  ws.getRangeByIndexes(0,0,data.length,data[0].length).values = data;
  ws.getRangeByIndexes(0,0,1,data[0].length).format = { fill:"#1F4E78", font:{bold:true,color:"#FFFFFF"}, wrapText:true };
  ws.getRangeByIndexes(0,0,data.length,data[0].length).format.borders = { preset:"outside", style:"thin", color:"#B7C9D6" };
  ws.freezePanes.freezeRows(1);
  ws.getUsedRange().format.autofitColumns();
  ws.getUsedRange().format.autofitRows();
}

const norm = wb.worksheets.getItem("Quarterly_Normalized");
norm.getRange("O2").formulasR1C1 = [["=IF(RC[2]<>\"\",1-RC[2],IF(RC[-3]<>\"\",RC[-2]/RC[-3],\"\"))"]];
norm.getRange(`O2:O${rows.length + 1}`).fillDown();
norm.getRange(`O2:O${rows.length + 1}`).format.numberFormat = "0.0%";

await writeCsv("quarterly_raw.csv", qHeaders, rows);
await writeCsv("quarterly_normalized.csv", qHeaders, rows);
await writeCsv("service_annual.csv", serviceHeaders, serviceRows);
await writeCsv("provenance.csv", provHeaders, provRows);

const errors = await wb.inspect({ kind:"match", searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options:{ useRegex:true, maxResults:50 }, maxChars:2000 });
console.log(errors.ndjson);
const output = await SpreadsheetFile.exportXlsx(wb);
await output.save(workbookPath);
console.log(workbookPath);
