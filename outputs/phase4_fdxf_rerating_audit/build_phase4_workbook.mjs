import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = fileURLToPath(new URL(".", import.meta.url));
const outputPath = `${outputDir}FDXF_Street_Rerating_Audit_FINAL.xlsx`;

const src = {
  FDXF_STATS: "https://stockanalysis.com/stocks/fdxf/statistics/",
  FDXF_FORECAST: "https://stockanalysis.com/stocks/fdxf/forecast/",
  FDXF_Q4: "https://ir.fedexfreight.com/news-events/press-releases/detail/185/fedex-freight-reports-fourth-quarter-and-full-fiscal-year-2026-financial-results",
  FDXF_INVESTOR_DAY: "https://investors.fedex.com/news-and-events/investor-news/investor-news-details/2026/FedEx-Freight-Hosts-Inaugural-Investor-Day-Ahead-of-Planned-Spinoff-from-FedEx/default.aspx",
  JEFFERIES: "https://www.investing.com/news/analyst-ratings/jefferies-initiates-fedex-freight-stock-with-buy-rating-200-target-93CH-4754826",
  JEFFERIES_METHOD: "https://intellectia.ai/news/stock/fedex-freight-earns-buy-rating-from-jefferies",
  RAYMOND_JAMES: "https://www.investing.com/news/analyst-ratings/raymond-james-initiates-fedex-freight-stock-with-outperform-rating-93CH-4723983",
  GOLDMAN: "https://www.investing.com/news/analyst-ratings/goldman-sachs-initiates-fedex-freight-stock-with-buy-rating-93CH-4769606",
  BOFA: "https://www.marketscreener.com/news/bofa-securities-adjusts-price-target-on-fedex-freight-to-187-from-185-maintains-buy-rating-ce7f5fd9df89f127",
  BOFA_MULTIPLE: "https://www.tipranks.com/news/the-fly/fedex-freight-price-target-raised-to-187-from-185-at-bofa-thefly-news",
  BOFA_INIT: "https://www.streetinsider.com/Analyst%2BComments/BofA%2BSecurities%2BStarts%2BFedEx%2BFreight%2BHolding%2BCompany%2B%28FDXF%29%2Bat%2BBuy/26580889.html",
  MORNINGSTAR: "https://www.morningstar.com/company-reports/1484081-following-spinoff-we-are-initiating-coverage-on-fedex-freight-with-102-fair-value-estimate",
  GOOGLE_FINANCE: "https://www.google.com/finance/quote/FDXF:NYSE",
  FDXF_MARKETSCREENER_VAL: "https://www.marketscreener.com/quote/stock/FEDEX-FREIGHT-HOLDING-COM-209228550/valuation/",
  FDXF_MARKETSCREENER_FIN: "https://www.marketscreener.com/quote/stock/FEDEX-FREIGHT-HOLDING-COM-209228550/finances/",
  ODFL_STATS: "https://stockanalysis.com/stocks/odfl/statistics/",
  ODFL_RATIOS: "https://stockanalysis.com/stocks/odfl/financials/ratios/",
  ODFL_Q1: "https://www.sec.gov/Archives/edgar/data/878927/000087892726000009/odfl-ex99_1.htm",
  ODFL_QTD: "https://ir.odfl.com/sec-filings/all-sec-filings/content/0000878927-26-000015/odfl-ex99_1.htm",
  XPO_STATS: "https://stockanalysis.com/stocks/xpo/statistics/",
  XPO_RATIOS: "https://stockanalysis.com/stocks/xpo/financials/ratios/",
  XPO_Q1: "https://investors.xpo.com/news-releases/news-release-details/xpo-reports-first-quarter-2026-results/",
  SAIA_STATS: "https://stockanalysis.com/stocks/saia/statistics/",
  SAIA_RATIOS: "https://stockanalysis.com/stocks/saia/financials/ratios/",
  SAIA_Q1: "https://www.sec.gov/Archives/edgar/data/1177702/000119312526194062/saia-ex99_1.htm",
  SAIA_QTD: "https://www.sec.gov/Archives/edgar/data/1177702/000119312526252530/saia-ex99_1.htm",
  MASTIO: "https://www.gain.consulting/post/2025-mastio-ltl-carrier-rankings-insights-into-customer-value-and-loyalty",
  PHASE3: "C:/Users/wei34/Java without ONe/CAD_AI/outputs/phase3_amazon_ltl_overlap/Amazon_LTL_FDXF_Overlap.xlsx",
};
const url = (ids) => ids.split(";").map((x) => src[x.trim()] ?? x.trim()).join("\n");

const order = ["Executive_Summary", "Street_Targets", "Target_Decomposition", "Peer_Valuation", "Peer_Operating_Metrics", "Historical_Multiples", "Multiple_Ladder", "Valuation_Sensitivity", "Sources", "Limitations"];
const wb = Workbook.create();
const ws = Object.fromEntries(order.map((name) => [name, wb.worksheets.add(name)]));

function col(n) {
  let out = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function writeSheet(sheet, headers, rows, widths = []) {
  sheet.showGridLines = false;
  const data = [headers, ...rows];
  sheet.getRangeByIndexes(0, 0, data.length, headers.length).values = data;
  sheet.freezePanes.freezeRows(1);
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format = {
    fill: "#1F4E78",
    font: { bold: true, color: "#FFFFFF" },
    horizontalAlignment: "Center",
    wrapText: true,
  };
  sheet.getRangeByIndexes(1, 0, Math.max(rows.length, 1), headers.length).format = { wrapText: true, verticalAlignment: "Top" };
  widths.forEach((w, i) => { if (w) sheet.getRangeByIndexes(0, i, data.length, 1).format.columnWidth = w; });
}

function formulas(sheet, pairs) { for (const [addr, fx] of pairs) sheet.getRange(addr).formulas = [[fx]]; }
function pct(sheet, range) { sheet.getRange(range).setNumberFormat("0.0%;[Red](0.0%);-"); }
function mult(sheet, range) { sheet.getRange(range).setNumberFormat("0.0x;[Red](0.0x);-"); }
function curr(sheet, range) { sheet.getRange(range).setNumberFormat("$0.00;[Red]($0.00);-"); }
function mm(sheet, range) { sheet.getRange(range).setNumberFormat("$#,##0;[Red]($#,##0);-"); }

const assumptions = [
  ["Assumption", "Value", "Notes", "Source URL"],
  ["As-of date", "2026-08-11", "Latest public market snapshot used where available", url("FDXF_STATS")],
  ["FDXF current price ($/sh)", 139.51, "StockAnalysis close, Aug. 11, 2026", url("FDXF_STATS")],
  ["FDXF shares outstanding (mm)", 149.52, "StockAnalysis share statistics", url("FDXF_STATS")],
  ["FDXF market cap ($mm)", 20860, "StockAnalysis total valuation", url("FDXF_STATS")],
  ["FDXF enterprise value ($mm)", 26970, "StockAnalysis total valuation", url("FDXF_STATS")],
  ["FDXF net debt ($mm)", null, "Formula: EV less equity market cap", url("FDXF_STATS")],
  ["FDXF FY26 revenue ($mm)", 8800, "StockAnalysis and FDXF FY26 release", url("FDXF_STATS;FDXF_Q4")],
  ["FDXF FY26 GAAP operating income ($mm)", 616, "Company full fiscal 2026 highlight", url("FDXF_Q4")],
  ["FDXF FY26 adjusted operating income ($mm)", 1108, "Company non-GAAP reconciliation", url("FDXF_Q4")],
  ["FDXF depreciation and amortization ($mm)", 449, "StockAnalysis cash flow disclosure", url("FDXF_STATS")],
  ["FDXF adjusted EBITDA proxy ($mm)", null, "Adjusted OI plus D&A proxy", url("FDXF_Q4;FDXF_STATS")],
  ["FDXF current GAAP EBITDA ($mm)", 989, "StockAnalysis income statement", url("FDXF_STATS")],
  ["FDXF FY26 EPS consensus / adjusted ($/sh)", 4.25, "StockAnalysis forecast", url("FDXF_FORECAST")],
  ["FDXF FY27 EPS consensus ($/sh)", 5.01, "StockAnalysis forecast", url("FDXF_FORECAST")],
  ["Current FY26 forward P/E", null, "Current price divided by FY26 EPS", url("FDXF_STATS;FDXF_FORECAST")],
  ["Current adjusted EV/EBITDA proxy", null, "Current EV divided by adjusted EBITDA proxy", url("FDXF_STATS;FDXF_Q4")],
  ["Medium-term revenue CAGR", 0.05, "Midpoint of management 4-6% framework", url("FDXF_INVESTOR_DAY")],
  ["Terminal adjusted operating margin", 0.149, "Approx. implied by adjusted OI growth against revenue growth", url("FDXF_INVESTOR_DAY;FDXF_Q4")],
  ["D&A / revenue assumption", null, "Current D&A as % of revenue", url("FDXF_STATS")],
  ["Terminal year revenue ($mm)", null, "FY26 revenue compounded for three years", url("FDXF_INVESTOR_DAY")],
  ["Terminal adjusted operating income ($mm)", null, "Revenue times operating margin", url("FDXF_INVESTOR_DAY;FDXF_Q4")],
  ["Terminal EBITDA base ($mm)", null, "Adjusted OI plus D&A proxy", url("FDXF_INVESTOR_DAY;FDXF_Q4")],
  ["Assumed net debt reduction through terminal ($mm)", 1000, "Illustrative deleveraging input; user editable", "Analyst assumption"],
  ["Terminal net debt ($mm)", null, "Current net debt less assumed reduction, floored at zero", "Formula"],
  ["Jefferies 2028E EPS estimate ($/sh)", 5.93, "Public reporting of Jefferies 2028 EPS estimate used for same-EPS-horizon P/E comparison", url("JEFFERIES_METHOD")],
  ["Jefferies stated / reported target P/E", 33.5, "Public reporting indicates approx. 33.5x target P/E; $200 / $5.93 calculates to 33.7x", url("JEFFERIES_METHOD;JEFFERIES")],
  ["Jefferies stated / reported target 2028E EV/EBITDA", 17.5, "Public reporting indicates approx. 17.5x 2028E EV/EBITDA; underlying report is not fully public", url("JEFFERIES_METHOD")],
  ["BofA CY2027 EPS estimate after Q4 ($/sh)", 5.41, "Public reporting of BofA CY2027 EPS estimate after Q4", url("BOFA_MULTIPLE")],
  ["FDXF 2027E EBITDA consensus ($mm)", 1754, "MarketScreener consensus valuation snapshot", url("FDXF_MARKETSCREENER_VAL")],
  ["FDXF 2028E EBITDA consensus ($mm)", 1940, "MarketScreener consensus valuation snapshot", url("FDXF_MARKETSCREENER_VAL")],
  ["FDXF 2027E net debt consensus ($mm)", 3507, "MarketScreener consensus valuation snapshot", url("FDXF_MARKETSCREENER_VAL")],
  ["FDXF 2028E net debt consensus ($mm)", 2586, "MarketScreener consensus valuation snapshot", url("FDXF_MARKETSCREENER_VAL")],
  ["FDXF 2027E EV/EBITDA consensus", 14.3, "MarketScreener same-horizon forward EV/EBITDA", url("FDXF_MARKETSCREENER_VAL")],
  ["FDXF 2028E EV/EBITDA consensus", 12.5, "MarketScreener same-horizon forward EV/EBITDA", url("FDXF_MARKETSCREENER_VAL")],
  ["Discount years to 2028E terminal value", 2.0, "Discounts 2028 terminal equity value back to Aug. 11, 2026 valuation date", "Analyst assumption"],
  ["Discount years to 2027E terminal value", 1.0, "Shown for timing clarity; same-year forward rows use 0.0 years because they are valuation-date forward multiples", "Analyst assumption"],
  ["", "", "", ""],
  ["Source ID", "URL / Path", "Use", ""],
  ...Object.entries(src).map(([id, link]) => [id, link, "Used for target verification, peer valuation, operating metrics or prior-thesis context", ""]),
];
ws.Sources.showGridLines = false;
ws.Sources.getRangeByIndexes(0, 0, assumptions.length, 4).values = assumptions;
ws.Sources.getRange("A1:D1").format = { fill: "#1F4E78", font: { bold: true, color: "#FFFFFF" }, wrapText: true };
ws.Sources.getRange("A39:D39").format = { fill: "#1F4E78", font: { bold: true, color: "#FFFFFF" }, wrapText: true };
ws.Sources.getRange("A2:D100").format = { wrapText: true, verticalAlignment: "Top" };
ws.Sources.freezePanes.freezeRows(1);
[42, 22, 72, 20].forEach((w, i) => ws.Sources.getRangeByIndexes(0, i, assumptions.length, 1).format.columnWidth = w);
formulas(ws.Sources, [["B7", "=B6-B5"], ["B12", "=B10+B11"], ["B16", "=B3/B14"], ["B17", "=B6/B12"], ["B20", "=B11/B8"], ["B21", "=B8*(1+B18)^3"], ["B22", "=B21*B19"], ["B23", "=B22+B21*B20"], ["B25", "=MAX(B7-B24,0)"]]);
curr(ws.Sources, "B3:B3"); mm(ws.Sources, "B4:B13"); curr(ws.Sources, "B14:B15"); mult(ws.Sources, "B16:B17"); pct(ws.Sources, "B18:B20"); mm(ws.Sources, "B21:B25");
curr(ws.Sources, "B26:B26"); mult(ws.Sources, "B27:B28"); curr(ws.Sources, "B29:B29"); mm(ws.Sources, "B30:B33"); mult(ws.Sources, "B34:B35"); ws.Sources.getRange("B36:B37").setNumberFormat("0.0");
ws.Sources.getRange("B3:B25").format.font = { color: "#0000FF" };
ws.Sources.getRange("B26:B37").format.font = { color: "#0000FF" };
ws.Sources.getRange("B7:B7").format.font = { color: "#000000" };
ws.Sources.getRange("B12:B12").format.font = { color: "#000000" };
ws.Sources.getRange("B16:B17").format.font = { color: "#000000" };
ws.Sources.getRange("B20:B23").format.font = { color: "#000000" };
ws.Sources.getRange("B25:B25").format.font = { color: "#000000" };

const streetRows = [
  ["Jefferies", "Stephanie Moore", "2026-06-23", "Buy", 200, 160.94, null, null, null, null, "Jefferies $200 target; public reporting gives 2028E EPS of $5.93, target P/E approx. 33.5x, and target 2028E EV/EBITDA approx. 17.5x", "Path to 350+ bps margin expansion; largest network; pure-play at trough margins", url("JEFFERIES;JEFFERIES_METHOD")],
  ["Bank of America", "Ken Hoexter", "2026-06-26", "Buy", 187, 149.89, null, null, null, null, "BofA moved its target multiple below the average of XPO, ODFL and SAIA until clearer standalone financials are disclosed; CY2027 EPS estimate approx. $5.41", "Post-Q4 support, but qualitative evidence against immediate ODFL-like multiple convergence", url("BOFA;BOFA_MULTIPLE;BOFA_INIT")],
  ["Goldman Sachs", "Jordan Alliger", "2026-07-01", "Buy", 186, 151.00, null, null, null, null, "Public article has useful methodology fragments; FDXF traded at ~28x CY2027 EPS and ~23.5x CY2028 EPS versus peer averages around ~32x and ~28x", "Base case OR around 86.2%; blue-sky OR 85.4% in quarters 5-8 and below 85% later", url("GOLDMAN")],
  ["Raymond James", "Patrick Tyler Brown", "2026-06-03", "Outperform", 180, 153.34, null, null, null, null, "Full analyst report unavailable publicly; no public target multiple found", "Improved trucking cycle, service, pricing/volume opportunity, OR exceeding medium-term goals", url("RAYMOND_JAMES")],
  ["CFRA", "Not observable", "Not observable", "Not observable", null, null, null, null, null, null, "Could not verify referenced ~$178 target in public sources reviewed", "Do not invent methodology", "Public source not found"],
  ["Morningstar", "Matthew Young", "2026-06-02", "Fair value", 102, null, null, null, null, null, "Fair value estimate, not a Street price target; detailed model partly gated", "Market valuation sets high bar and is a counterweight to bull multiple cases", url("MORNINGSTAR")],
  ["Consensus / S&P Global via StockAnalysis", "12 analysts", "2026-07-29 check", "Buy", 169.42, null, null, null, null, null, "Aggregate consensus, not a single analyst valuation method", "Average target; high $200, median $176, low $108", url("FDXF_FORECAST")],
  ["Google Finance listed targets", "Multiple", "2026-06 to 2026-07", "Mixed", 176.38, null, null, null, null, null, "Useful cross-check; not a valuation method", "Lists Jefferies, BofA, Goldman, Raymond James and other targets", url("GOOGLE_FINANCE")],
];
writeSheet(ws.Street_Targets, ["Firm / Source", "Analyst", "Target Initiation / Update Date", "Rating", "Price Target / Fair Value", "FDXF Share Price on Target Date", "Original Implied Upside", "Current FDXF Price", "Current Implied Upside", "Change in Implied Upside (Timing Only)", "Valuation Methodology / Observable Inputs", "Thesis / Evidence", "Source URL"], streetRows, [24, 24, 18, 16, 18, 20, 18, 16, 18, 24, 66, 62, 88]);
for (let r = 2; r <= 9; r++) {
  formulas(ws.Street_Targets, [
    [`G${r}`, `=IF(OR(E${r}="",F${r}=""),"",E${r}/F${r}-1)`],
    [`H${r}`, `='Sources'!$B$3`],
    [`I${r}`, `=IF(E${r}="","",E${r}/H${r}-1)`],
    [`J${r}`, `=IF(OR(G${r}="",I${r}=""),"",I${r}-G${r})`],
  ]);
}
curr(ws.Street_Targets, "E2:F9"); curr(ws.Street_Targets, "H2:H9"); pct(ws.Street_Targets, "G2:G9"); pct(ws.Street_Targets, "I2:J9");

const decompRows = [
  ["Jefferies", 200, "2026-06-23", 160.94, null, null, null, null, "2028E", 5.93, null, null, 17.5, "Same-EPS-Horizon P/E Comparison; high-end bull valuation, not current spot P/E", url("JEFFERIES;JEFFERIES_METHOD")],
  ["Bank of America", 187, "2026-06-26", 149.89, null, null, null, null, "CY2027E", 5.41, null, null, null, "BofA qualitative multiple evidence: target multiple moved below XPO/ODFL/SAIA average pending clearer standalone financials", url("BOFA;BOFA_MULTIPLE;BOFA_INIT")],
  ["Goldman Sachs", 186, "2026-07-01", 151.00, null, null, null, null, "CY2027E / CY2028E", null, null, null, null, "Public article notes FDXF traded below peer-average forward P/E snapshots; exact target model not public", url("GOLDMAN")],
  ["Raymond James", 180, "2026-06-03", 153.34, null, null, null, null, "", null, null, null, null, "No public target multiple found; treat target-date upside as timing math only", url("RAYMOND_JAMES")],
  ["CFRA", null, "Not observable", null, null, null, null, null, "", null, null, null, null, "Target and valuation method not publicly verified", "Public source not found"],
  ["Morningstar fair value", 102, "2026-06-02", null, null, null, null, null, "", null, null, null, null, "Fair value estimate, not a Street price target; target-date price unavailable", url("MORNINGSTAR")],
  ["Consensus / S&P Global via StockAnalysis", 169.42, "2026-07-29 check", null, null, null, null, null, "", null, null, null, null, "Aggregate target only; no analyst-specific valuation basis", url("FDXF_FORECAST")],
  ["Google Finance listed targets", 176.38, "2026-06 to 2026-07", null, null, null, null, null, "", null, null, null, null, "Aggregate/listed targets only; no valuation methodology", url("GOOGLE_FINANCE")],
];
writeSheet(ws.Target_Decomposition, ["Firm / Source", "Target Price / Fair Value", "Target Date", "FDXF Share Price on Target Date", "Original Implied Upside", "Current FDXF Price", "Current Implied Upside", "Change in Implied Upside (Timing Only)", "EPS Horizon", "EPS Estimate", "Current Price / EPS Horizon", "Target Price / EPS Horizon", "Target 2028E EV/EBITDA", "Interpretation", "Source URL"], decompRows, [28, 18, 18, 22, 18, 16, 18, 24, 16, 14, 22, 22, 22, 70, 88]);
for (let r = 2; r <= 9; r++) {
  formulas(ws.Target_Decomposition, [
    [`E${r}`, `=IF(OR(B${r}="",D${r}=""),"",B${r}/D${r}-1)`],
    [`F${r}`, `='Sources'!$B$3`],
    [`G${r}`, `=IF(B${r}="","",B${r}/F${r}-1)`],
    [`H${r}`, `=IF(OR(E${r}="",G${r}=""),"",G${r}-E${r})`],
    [`K${r}`, `=IF(OR(F${r}="",J${r}=""),"",F${r}/J${r})`],
    [`L${r}`, `=IF(OR(B${r}="",J${r}=""),"",B${r}/J${r})`],
  ]);
}
curr(ws.Target_Decomposition, "B2:B9"); curr(ws.Target_Decomposition, "D2:D9"); curr(ws.Target_Decomposition, "F2:F9"); pct(ws.Target_Decomposition, "E2:E9"); pct(ws.Target_Decomposition, "G2:H9"); curr(ws.Target_Decomposition, "J2:J9"); mult(ws.Target_Decomposition, "K2:M9");

writeSheet(ws.Peer_Valuation, ["Ticker", "Company", "Price", "Market Cap ($mm)", "EV ($mm)", "Reported / Current EV/EBITDA", "Forward P/E", "2027E EV/EBITDA", "2028E EV/EBITDA", "2027E EBITDA ($mm)", "2028E EBITDA ($mm)", "Comparability Note", "Source URL"], [
  ["FDXF", "FedEx Freight", 139.51, 20860, 26970, null, 32.81, 14.3, 12.5, 1754, 1940, "Same-horizon FDXF consensus estimates shown; do not compare adjusted trailing proxy directly to peer reported trailing EBITDA", url("FDXF_STATS;FDXF_FORECAST;FDXF_MARKETSCREENER_VAL")],
  ["ODFL", "Old Dominion", 209.44, 43430, 43160, 23.87, 34.11, null, null, null, null, "Reliable 2027E/2028E EV/EBITDA not available in accessible source snapshot; leave blank rather than infer from trailing data", url("ODFL_STATS")],
  ["XPO", "XPO", 200.21, 23440, 27190, 21.18, 34.07, null, null, null, null, "Reliable 2027E/2028E EV/EBITDA not available in accessible source snapshot; leave blank rather than infer from partial consensus data", url("XPO_STATS")],
  ["SAIA", "Saia", 356.96, 9500, 9680, 15.47, 28.03, null, null, null, null, "Reliable 2027E/2028E EV/EBITDA not available in accessible source snapshot; leave blank rather than infer from partial consensus data", url("SAIA_STATS")],
], [10, 22, 12, 16, 14, 24, 12, 16, 16, 18, 18, 76, 88]);
formulas(ws.Peer_Valuation, [["F2", "='Sources'!$B$17"], ["H2", "='Sources'!$B$34"], ["I2", "='Sources'!$B$35"], ["J2", "='Sources'!$B$30"], ["K2", "='Sources'!$B$31"]]);
curr(ws.Peer_Valuation, "C2:C5"); mm(ws.Peer_Valuation, "D2:E5"); mult(ws.Peer_Valuation, "F2:I5"); mm(ws.Peer_Valuation, "J2:K5"); mult(ws.Peer_Valuation, "G2:G5");

writeSheet(ws.Peer_Operating_Metrics, ["Ticker", "Revenue Growth", "Shipment / Tonnage Growth", "Yield / Ex-Fuel Yield", "Operating Margin / OR", "ROIC", "FCF Conversion", "Capex / Revenue", "Net Debt / EBITDA", "Mastio / Service Rank", "Claims / On-time KPI", "Source URL"], [
  ["FDXF", "4-6% medium-term target; transition +4-6% vs $5.1B seven-month 2025 base", "Q4 shipments -5.9%; FY26 revenue -1.1%", "Revenue/shipment +11.5%; revenue/cwt +8.2% in Q4", "FY26 GAAP margin 7.0%; adjusted 12.6%", 7.56, "Target >90%", "~5% target", 4.91, "Public rank weaker than ODFL/XPO/Saia in cited survey", "Record-low DOT preventable accident performance; published transit/service claims", url("FDXF_Q4;FDXF_INVESTOR_DAY;FDXF_STATS;MASTIO")],
  ["ODFL", "3Y revenue forecast 7.89%; Q1 revenue -2.9%", "Q1 demand improved; May tons/day -3.8%, shipments/day -5.3%", "May QTD rev/cwt ex fuel +5.4%", "Q1 OR 76.2%; TTM operating margin 25.42%", 25.36, "TTM FCF / NI approx 102%", "TTM capex/revenue approx 5.0%", 0.01, "Mastio national #1 / best traditional quality proxy", "99% on-time and claims below 0.1% in Q1", url("ODFL_Q1;ODFL_QTD;ODFL_STATS;MASTIO")],
  ["XPO", "3Y revenue forecast 7.58%; Q1 company revenue +7.3%", "Q1 LTL shipments/day +3.0%; tonnage/day +0.1%", "Q1 LTL yield ex fuel +4.0%", "Q1 NA LTL adjusted OR 83.9%; TTM operating margin 9.90%", 11.03, "TTM FCF / NI approx 146%", "TTM capex/revenue approx 5.8%", 3.15, "Mastio national #4 in cited survey", "Damage claims ratio below 0.2% in Q1", url("XPO_Q1;XPO_STATS;MASTIO")],
  ["SAIA", "3Y revenue forecast 9.00%; Q1 revenue +2.4%", "Q1 shipments/day +1.0%; tonnage/day -2.1%; Apr/May QTD shipments +4.6%", "Q1 rev/cwt ex fuel +1.9%; Apr/May tonnage +7.6%", "Q1 OR 91.7%; TTM operating margin 10.68%", 9.53, "TTM FCF / NI approx 92%", "TTM capex/revenue approx 10.4%", 0.43, "Mastio national #5/#6 depending cited year", "Current claims ratio not found in public source reviewed", url("SAIA_Q1;SAIA_QTD;SAIA_STATS;MASTIO")],
], [10, 40, 42, 38, 38, 10, 18, 18, 18, 42, 48, 88]);

const histRows = [
  ["ODFL", "Forward P/E", 34.11, 32.07, 32.27, 31.75, 24.28, 35.73, null, null, null, null, null, "Premium traditional LTL; relatively clean history"],
  ["ODFL", "EV/EBITDA", 23.87, 18.90, 19.87, 22.30, 14.71, 24.58, null, null, null, null, null, "Premium traditional LTL; relatively clean history"],
  ["XPO", "Forward P/E", 34.07, 32.51, 32.39, 26.01, 9.84, 17.06, null, null, null, null, null, "Pre- and during-transformation history not directly comparable"],
  ["XPO", "EV/EBITDA", 21.20, 16.72, 16.73, 15.94, 8.62, 13.38, null, null, null, null, null, "Pre- and during-transformation history not directly comparable"],
  ["SAIA", "Forward P/E", 28.18, 32.21, 30.83, 28.34, 16.19, 30.16, null, null, null, null, null, "Terminal expansion and Yellow absorption period need annotation"],
  ["SAIA", "EV/EBITDA", 15.37, 14.96, 17.95, 17.95, 8.79, 18.73, null, null, null, null, null, "Terminal expansion and Yellow absorption period need annotation"],
];
writeSheet(ws.Historical_Multiples, ["Ticker", "Metric", "Current", "FY2025", "FY2024", "FY2023", "FY2022", "FY2021", "Median", "25th Percentile", "75th Percentile", "Low", "High", "Annotation"], histRows, [10, 16, 12, 12, 12, 12, 12, 12, 12, 16, 16, 10, 10, 52]);
for (let r = 2; r <= 7; r++) formulas(ws.Historical_Multiples, [[`I${r}`, `=MEDIAN(C${r}:H${r})`], [`J${r}`, `=QUARTILE.INC(C${r}:H${r},1)`], [`K${r}`, `=QUARTILE.INC(C${r}:H${r},3)`], [`L${r}`, `=MIN(C${r}:H${r})`], [`M${r}`, `=MAX(C${r}:H${r})`]]);
mult(ws.Historical_Multiples, "C2:M7");

writeSheet(ws.Multiple_Ladder, ["Case", "Valuation Approach", "EBITDA Horizon", "EBITDA Estimate ($mm)", "EV/EBITDA Multiple", "Net Debt Assumption ($mm)", "Future Equity Value / Share", "Discount Years", "PV @ 8%", "PV @ 10%", "PV @ 12%", "Current / Reference Price", "Interpretation"], [
  ["Same-year 2027E consensus", "Valuation-date forward EBITDA/multiple", "2027E", null, null, null, null, 0.0, null, null, null, null, "Same-horizon forward multiple; no terminal value discounting applied"],
  ["Same-year 2028E consensus", "Valuation-date forward EBITDA/multiple", "2028E", null, null, null, null, 0.0, null, null, null, null, "Same-horizon forward multiple; no terminal value discounting applied"],
  ["Terminal 2028E at consensus multiple", "Discount future terminal equity value", "2028E terminal", null, null, null, null, null, null, null, null, null, "Discounts 2028 terminal equity value back to Aug. 11, 2026"],
  ["Terminal 2028E at Jefferies bull multiple", "Discount future terminal equity value", "2028E terminal", null, null, null, null, null, null, null, null, null, "Uses Jefferies reported 17.5x 2028E EV/EBITDA; illustrative if consensus EBITDA is used as the denominator"],
  ["Terminal 2028E at ODFL-like current multiple", "Discount future terminal equity value", "2028E terminal", null, 23.87, null, null, null, null, null, null, null, "Illustrative upper benchmark only; not evidence that consensus assumes immediate ODFL-like convergence"],
  ["Consensus target implied 2028E terminal multiple", "Back-solve multiple from current consensus target", "2028E terminal", null, null, null, 169.42, null, null, null, null, null, "Shows what the aggregate target implies under the same 2028E EBITDA and net debt assumptions"],
], [30, 34, 18, 18, 18, 22, 22, 14, 14, 14, 14, 20, 80]);
formulas(ws.Multiple_Ladder, [
  ["D2", "='Sources'!$B$30"], ["E2", "='Sources'!$B$34"], ["F2", "='Sources'!$B$32"],
  ["D3", "='Sources'!$B$31"], ["E3", "='Sources'!$B$35"], ["F3", "='Sources'!$B$33"],
  ["D4", "='Sources'!$B$31"], ["E4", "='Sources'!$B$35"], ["F4", "='Sources'!$B$33"], ["H4", "='Sources'!$B$36"],
  ["D5", "='Sources'!$B$31"], ["E5", "='Sources'!$B$28"], ["F5", "='Sources'!$B$33"], ["H5", "='Sources'!$B$36"],
  ["D6", "='Sources'!$B$31"], ["F6", "='Sources'!$B$33"], ["H6", "='Sources'!$B$36"],
  ["D7", "='Sources'!$B$31"], ["E7", "=(G7*'Sources'!$B$4+F7)/D7"], ["F7", "='Sources'!$B$33"], ["H7", "='Sources'!$B$36"],
]);
for (let r = 2; r <= 6; r++) formulas(ws.Multiple_Ladder, [[`G${r}`, `=IF(OR(D${r}="",E${r}="",F${r}=""),"",((D${r}*E${r})-F${r})/'Sources'!$B$4)`]]);
for (let r = 2; r <= 7; r++) {
  formulas(ws.Multiple_Ladder, [
    [`I${r}`, `=IF(G${r}="","",G${r}/(1+8%)^H${r})`],
    [`J${r}`, `=IF(G${r}="","",G${r}/(1+10%)^H${r})`],
    [`K${r}`, `=IF(G${r}="","",G${r}/(1+12%)^H${r})`],
    [`L${r}`, `='Sources'!$B$3`],
  ]);
}
mm(ws.Multiple_Ladder, "D2:D7"); mult(ws.Multiple_Ladder, "E2:E7"); mm(ws.Multiple_Ladder, "F2:F7"); curr(ws.Multiple_Ladder, "G2:G7"); curr(ws.Multiple_Ladder, "I2:L7"); ws.Multiple_Ladder.getRange("H2:H7").setNumberFormat("0.0");

writeSheet(ws.Valuation_Sensitivity, ["Terminal EBITDA ($mm) \\ EV/EBITDA", "12.0x", "15.0x", "17.5x", "20.0x", "22.5x", "25.0x"], [
  [1600, null, null, null, null, null, null],
  [1800, null, null, null, null, null, null],
  [2000, null, null, null, null, null, null],
  [2200, null, null, null, null, null, null],
  [2400, null, null, null, null, null, null],
  ["", "", "", "", "", "", ""],
  ["Revenue CAGR \\ Terminal Op Margin", 0.12, 0.14, 0.16, 0.18, "", ""],
  [0.02, null, null, null, null, "", ""],
  [0.04, null, null, null, null, "", ""],
  [0.06, null, null, null, null, "", ""],
  [0.08, null, null, null, null, "", ""],
], [30, 14, 14, 14, 14, 14, 14]);
for (let r = 2; r <= 6; r++) for (let c = 2; c <= 7; c++) formulas(ws.Valuation_Sensitivity, [[`${col(c)}${r}`, `=(($A${r}*VALUE(SUBSTITUTE(${col(c)}$1,"x","")))-'Sources'!$B$25)/'Sources'!$B$4`]]);
for (let r = 9; r <= 12; r++) for (let c = 2; c <= 5; c++) formulas(ws.Valuation_Sensitivity, [[`${col(c)}${r}`, `=((('Sources'!$B$8*(1+$A${r})^3)*(${col(c)}$8+'Sources'!$B$20)*'Sources'!$B$17)-'Sources'!$B$25)/'Sources'!$B$4`]]);
curr(ws.Valuation_Sensitivity, "B2:G6"); curr(ws.Valuation_Sensitivity, "B9:E12");
pct(ws.Valuation_Sensitivity, "B8:E8"); pct(ws.Valuation_Sensitivity, "A9:A12");

writeSheet(ws.Executive_Summary, ["Question", "Answer / Conclusion", "Evidence / Interpretation", "Support Sheet"], [
  ["A. Consensus / moderate Street", "Does NOT appear to assume immediate ODFL-like valuation", "Consensus and BofA evidence point to a more moderate stance; BofA explicitly moved its target multiple below the XPO/ODFL/SAIA leader average until clearer standalone financials are disclosed.", "Street_Targets;Target_Decomposition;Peer_Valuation"],
  ["B. High-end bull case", "Jefferies $200 target capitalizes FDXF at approximately 33.5x 2028E EPS / 17.5x 2028E EBITDA", "The workbook calculates current price / Jefferies 2028E EPS and target price / Jefferies 2028E EPS as a Same-EPS-Horizon P/E Comparison. This is not a current spot P/E claim.", "Target_Decomposition;Multiple_Ladder"],
  ["C. Variant perception", "The debate is whether FDXF earns a quality rerating before it demonstrates sustained peer-quality service, profitable share growth, margin improvement and FCF execution", "The valuation case should be framed around execution milestones, not as evidence that every analyst assigns an ODFL-like multiple.", "Peer_Operating_Metrics;Limitations"],
  ["Timing repair", "Target-date upside and current implied upside are now shown separately for each analyst where source prices are available", "The change in implied upside is labeled as timing only and should not be interpreted as valuation-basis or multiple-migration evidence.", "Street_Targets;Target_Decomposition"],
  ["Multiple ladder repair", "Same-year forward estimates and discounted 2028 terminal equity values are both shown", "Terminal rows explicitly identify 2028E and discount back two years at 8%, 10% and 12%. Same-year forward rows use 0.0 discount years.", "Multiple_Ladder"],
  ["Peer multiple alignment", "Same-horizon 2027E/2028E EV/EBITDA is populated for FDXF where reliable public consensus data is available", "ODFL, XPO and SAIA same-horizon rows are left blank where accessible source snapshots did not provide reliable comparable consensus EV/EBITDA.", "Peer_Valuation"],
  ["Sensitivity repair", "Revenue CAGR rows are 2%, 4%, 6%, 8%; operating margin columns are 12%, 14%, 16%, 18%", "Each operating-margin column now uses the column header directly and produces a distinct valuation output.", "Valuation_Sensitivity"],
], [34, 46, 76, 36]);

writeSheet(ws.Limitations, ["Limitation", "Explanation", "Severity", "Model Impact"], [
  ["Analyst reports not fully public", "Full Jefferies, BofA, Raymond and CFRA valuation models are not fully public. Public reporting supports Jefferies EPS/multiple inputs and BofA qualitative multiple evidence, but detailed model build-ups remain unavailable.", "High", "Workbook separates verified public facts from interpretation and leaves non-observable fields blank."],
  ["Target-date price precision", "Target-date FDXF prices are sourced from public articles or source-page market snapshots where available, not from licensed analyst-report VWAP tables.", "Medium", "Original implied upside should be treated as approximate timing math."],
  ["Consensus data source limitations", "StockAnalysis, TipRanks and MarketScreener snapshots may update over time and may reflect different source dates.", "Medium", "Refresh with licensed consensus before final publication."],
  ["FDXF post-spin transition noise", "Trailing FCF, GAAP margins and leverage are affected by spin-off costs, new debt and fiscal-year transition.", "High", "Workbook avoids direct comparability claims between FDXF adjusted trailing EBITDA proxy and peer reported trailing EBITDA."],
  ["Peer forward multiple availability", "Reliable same-horizon 2027E/2028E EV/EBITDA for ODFL, XPO and SAIA was not available in the accessible source snapshot used for this repair.", "High", "Peer forward multiple cells are intentionally blank instead of inferred."],
  ["Terminal valuation sensitivity", "Discounted terminal rows use explicit discount rates and consensus FDXF EBITDA/net debt. If Jefferies uses different 2028E EBITDA or net debt, the implied equity value will differ.", "Medium", "Use the ladder as an auditable framework, not a substitute for the full analyst model."],
  ["Prior thesis integration is contextual", "Healthcare TAM and Amazon overlap are incorporated as evidence investors need to monitor, not as automatic valuation haircuts.", "Medium", "Do not force a bearish or bullish conclusion from prior phases alone."],
], [30, 78, 14, 64]);

const checks = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 100 }, summary: "formula error scan" });
console.log(checks.ndjson);
for (const name of order) {
  const png = await wb.render({ sheetName: name, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(`${outputDir}${name}.png`, new Uint8Array(await png.arrayBuffer()));
}
await fs.mkdir(outputDir, { recursive: true });
const out = await SpreadsheetFile.exportXlsx(wb);
await out.save(outputPath);
console.log(outputPath);
