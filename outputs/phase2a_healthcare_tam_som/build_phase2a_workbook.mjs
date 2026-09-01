import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "outputs/phase2a_healthcare_tam_som";
const outputPath = `${outputDir}/FDXF_Healthcare_TAM_SOM.xlsx`;
await fs.mkdir(outputDir, { recursive: true });

const wb = Workbook.create();

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

function addSheet(name, rows, options = {}) {
  const sheet = wb.worksheets.add(name);
  sheet.showGridLines = false;
  const data = normalize(rows);
  const endCol = colLetter(data[0].length);
  sheet.getRangeByIndexes(0, 0, data.length, data[0].length).values = data;
  const headerRow = options.headerRow ?? 1;
  sheet.getRange(`A${headerRow}:${endCol}${headerRow}`).format = {
    fill: "#174A7C",
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#AAB7C4" },
  };
  sheet.getRange(`A1:${endCol}${data.length}`).format = {
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#D9E2EC" },
  };
  sheet.getRange(`A1:${endCol}${data.length}`).format.autofitColumns();
  sheet.getRange(`A1:${endCol}${data.length}`).format.autofitRows();
  if (options.freezeRows) sheet.freezePanes.freezeRows(options.freezeRows);
  return sheet;
}

function setNumberFormat(sheet, range, format) {
  sheet.getRange(range).setNumberFormat(format);
}

const sources = [
  ["FDX_INV_DAY_P13", "FedEx Freight Investor Day Presentation", "FedEx Freight", "2026-04-08", "https://d1io3yog0oux5.cloudfront.net/_5705b101ff53031529c842d008f96e5d/fedexfreight/db/3570/34491/presentation/FedEx+Freight+Investor+Day+Presentation.pdf", "Investor presentation", "4%-6% medium-term revenue CAGR target.", "Primary source."],
  ["FDX_INV_DAY_P35", "FedEx Freight Investor Day Presentation", "FedEx Freight", "2026-04-08", "https://d1io3yog0oux5.cloudfront.net/_5705b101ff53031529c842d008f96e5d/fedexfreight/db/3570/34491/presentation/FedEx+Freight+Investor+Day+Presentation.pdf", "Investor presentation", "FY26E revenue mix; 3% Other includes Custom Critical and specialty services.", "Primary source."],
  ["FDX_INV_DAY_P37", "FedEx Freight Investor Day Presentation", "FedEx Freight", "2026-04-08", "https://d1io3yog0oux5.cloudfront.net/_5705b101ff53031529c842d008f96e5d/fedexfreight/db/3570/34491/presentation/FedEx+Freight+Investor+Day+Presentation.pdf", "Investor presentation", "Revenue by industry, customer base and tenure.", "Primary source."],
  ["FDX_INV_DAY_P44", "FedEx Freight Investor Day Presentation", "FedEx Freight", "2026-04-08", "https://d1io3yog0oux5.cloudfront.net/_5705b101ff53031529c842d008f96e5d/fedexfreight/db/3570/34491/presentation/FedEx+Freight+Investor+Day+Presentation.pdf", "Investor presentation", "Healthcare/pharma/life sciences opportunity and $6B headline TAM footnote.", "Primary source; footnote says third-party estimates incorporating census commodity-flow data."],
  ["FDX_INV_DAY_P63", "FedEx Freight Investor Day Presentation", "FedEx Freight", "2026-04-08", "https://d1io3yog0oux5.cloudfront.net/_5705b101ff53031529c842d008f96e5d/fedexfreight/db/3570/34491/presentation/FedEx+Freight+Investor+Day+Presentation.pdf", "Investor presentation", "Medium-term revenue and adjusted operating income framework.", "Primary source."],
  ["FDX_EVENT", "FedEx Freight Investor Day event page", "FedEx Freight IR", "2026-04-08", "https://ir.fedexfreight.com/news-events/events-presentation/20260408-investor-day-2026", "Investor relations page", "Company description; FedEx Custom Critical under FedEx Freight; network scope.", "Primary source."],
  ["FDX_Q4_FY26", "FedEx Freight Reports Fourth Quarter and Full Fiscal Year 2026 Financial Results", "FedEx Freight IR", "2026-07-xx", "https://ir.fedexfreight.com/news-events/press-releases/detail/185/fedex-freight-reports-fourth-quarter-and-full-fiscal-year-2026-financial-results", "Earnings release", "FY2026 revenue of $8.8B; Q4 volume and yield metrics.", "Primary source."],
  ["FDX_CUSTOM_CRITICAL", "FedEx Custom Critical owner-operator overview", "FedEx Custom Critical", "Accessed 2026-08-11", "https://customcritical.fedex.com/us/owneroperator/overview/default.shtml", "Service page", "24/7/365 time-specific critical-shipment carrier; Surface Expedite; White Glove; temperature control.", "Primary source."],
  ["FDX_HEALTHCARE", "Healthcare Shipping Solutions", "FedEx", "Accessed 2026-08-11", "https://images.fedex.com/en-us/healthcare.html", "Service page", "FedEx Surround, SenseAware, Priority Alert, healthcare temperature-controlled options.", "Primary source; mostly FedEx Corp not FDXF-specific."],
  ["CFS_2022", "2022 Commodity Flow Survey Final Tables", "U.S. Census Bureau / BTS", "2025-06", "https://www.census.gov/data/tables/2022/econ/cfs/aff-2022.html", "Government dataset", "Commodity-flow data basis cited by management footnote.", "Primary government source."],
  ["BTS_CFS", "Commodity Flow Survey 2022 Data Released", "Bureau of Transportation Statistics", "2025-06-26", "https://www.bts.gov/newsroom/commodity-flow-survey-2022-data-released", "Government release", "CFS scope and national freight-flow context.", "Primary government source."],
  ["UPS_AHG", "UPS to Acquire Andlauer Healthcare Group", "UPS Healthcare", "2025-04-24", "https://developer.ups.com/us/en/healthcare/news/press-releases/ups-to-aquire-andlauer-healthcare-group", "Press release", "CAD $2.2B / USD $1.6B acquisition; UPS Healthcare 19.2M+ sq ft cGMP/GDP distribution space.", "Competitor primary source."],
  ["DHL_INVEST", "DHL Group to Invest EUR 2 Billion by 2030 in DHL Health Logistics", "DHL Group", "2025-04-07", "https://group.dhl.com/en/media-relations/press-releases/2025/dhl-group-to-invest-2-billion-in-dhl-health-logistics.html", "Press release", "EUR2B investment; 2024 LSH revenue >EUR5B; nearly 600 sites; 2.5M sqm temperature-controlled warehouse space.", "Competitor primary source."],
  ["DHL_AIR_COLD", "DHL Group expands Airfreight Cold Chain Network", "DHL Group", "2026-02-19", "https://group.dhl.com/en/media-relations/press-releases/2026/dhl-group-expands-airfreight-cold-chain-network-to-advance-global-health-logistics.html", "Press release", "Dedicated pharma airfreight cold-chain network and visibility.", "Competitor primary source."],
  ["WORLD_COURIER", "Patient journeys / specialty pharma logistics", "World Courier", "Accessed 2026-08-11", "https://www.worldcourier.com/case-studies/patient-journeys", "Service page", "4,000+ team members; 120+ company-owned facilities; 50+ countries; 22 depots.", "Competitor primary source."],
  ["CENCORA_CLINICAL", "Clinical Trial Logistics Solutions", "Cencora", "Accessed 2026-08-11", "https://www.cencora.com/solutions/clinical-trial-logistics", "Service page", "Clinical-trial logistics, cold chain, real-time visibility, depot network.", "Competitor primary source."],
  ["WORLD_COURIER_US_EXP", "World Courier to Expand Storage Capacity and Cold Chain Capabilities", "Cencora", "2023-12-19", "https://www.cencora.com/newsroom/world-courier-to-expand-storage-and-cold-chain-capabilities-with-new-transport-stations-in-us", "Press release", "Three U.S. transport stations; North America network to 17 sites.", "Competitor primary source."],
  ["PUBLIC_SCAN", "Public source scan for named FDXF healthcare wins", "Analyst workbook note", "2026-08-11", "N/A", "Research note", "No named, revenue-sized FedEx Freight healthcare customer win found in public search for 2021-2026.", "Gap flag, not a primary source."]
];

const tamRows = [
  ["Pharmaceuticals", 2.0, 0.20, 0.35, 0.50, 0.40, 0.55, 0.70, null, null, null, 0.45, 0.15, 0.25, 0.15, "Large high-value flow, but many lanes require parcel/air, dedicated cold chain or specialized courier. Custom Critical captures time-critical exceptions better than generic LTL.", "FDX_INV_DAY_P44; CFS_2022; FDX_CUSTOM_CRITICAL; FDX_HEALTHCARE"],
  ["Biologics and advanced therapies", 1.3, 0.05, 0.15, 0.25, 0.30, 0.45, 0.55, null, null, null, 0.35, 0.10, 0.45, 0.10, "More temperature-sensitive and compliance-intensive; meaningful value exists, but FDXF-compatible portion is narrower without disclosed pharma hub footprint.", "FDX_INV_DAY_P44; DHL_INVEST; WORLD_COURIER; CENCORA_CLINICAL"],
  ["Medical devices", 1.1, 0.30, 0.50, 0.65, 0.50, 0.60, 0.75, null, null, null, 0.20, 0.20, 0.15, 0.20, "Bulkier, damage-sensitive device freight is comparatively more LTL/white-glove compatible than pharma cold chain.", "FDX_INV_DAY_P44; UPS_AHG; FDX_CUSTOM_CRITICAL"],
  ["Diagnostics and lab supplies", 0.5, 0.10, 0.20, 0.35, 0.35, 0.50, 0.60, null, null, null, 0.35, 0.10, 0.35, 0.10, "Specimen and reagent movements skew parcel/courier/cold-chain; some replenishment and equipment lanes are freight-compatible.", "FDX_HEALTHCARE; CENCORA_CLINICAL; WORLD_COURIER"],
  ["Hospital and clinical supplies", 0.6, 0.40, 0.55, 0.70, 0.45, 0.55, 0.70, null, null, null, 0.20, 0.30, 0.10, 0.15, "Palletized supplies are one of the most plausible LTL-compatible pools, although distributor networks and private/dedicated fleets constrain addressability.", "CFS_2022; FDX_INV_DAY_P44"],
  ["Life-sciences equipment", 0.5, 0.20, 0.35, 0.50, 0.40, 0.50, 0.65, null, null, null, 0.15, 0.25, 0.20, 0.20, "Instrumentation and lab equipment fit LTL/white-glove if damage prevention and appointment handling are strong.", "FDX_CUSTOM_CRITICAL; WORLD_COURIER"]
];

const exec = addSheet("Executive_Summary", [
  ["FedEx Freight Healthcare TAM -> SAM / Required Share", null, null, null, null],
  ["Prepared", "2026-08-11", "Scope", "Phase 2A only: healthcare TAM/SAM and right-to-win, no 2021-2023 peer-panel expansion.", null],
  [null, null, null, null, null],
  ["Question", "Answer", "Quant / Range", "Primary dependency", "Notes"],
  ["Is $6B reasonable headline TAM?", "Yes as a broad headline, not as direct FDXF LTL revenue.", 6.0, "FDX_INV_DAY_P44", "FedEx frames the opportunity around Custom Critical and time-definite reliability; the footnote cites third-party estimates incorporating Census commodity-flow data."],
  ["Estimated LTL-serviceable market", "Base FDXF-compatible SAM is materially smaller than headline TAM.", null, "TAM_to_SAM", "Low/base/high reflect LTL compatibility and FedEx capability compatibility by healthcare sub-segment."],
  ["Revenue Street/management growth framework requires", "Using management's 4%-6% medium-term CAGR and scenario healthcare contribution shares, required healthcare revenue by 2029 ranges from low hundreds of millions to roughly two-thirds of a billion.", null, "Required_Share", "The healthcare contribution share is an analyst assumption because no public vertical-specific sell-side estimate was found."],
  ["Share of SAM implied", "Base scenario requires a meaningful share of base SAM by 2029.", null, "Required_Share", "This is not trivial; the bull case needs stronger evidence of wins or capability expansion."],
  ["Judgment", "Plausible but difficult; not unsupported, not a layup.", null, "Competitor_Matrix; FedEx_Capabilities; Customer_Wins", "FedEx has real time-critical and network assets, but public evidence of named FDXF healthcare wins is thin versus UPS/DHL/World Courier."],
  ["Evidence contradicting a bearish thesis", "FedEx Freight owns a large North American LTL network and FedEx Custom Critical provides 24/7/365 expedited, white-glove and temperature-control services.", null, "FDX_EVENT; FDX_CUSTOM_CRITICAL; FDX_HEALTHCARE", "Bear thesis is weakened if Custom Critical captures high-value exceptions rather than competing only in generic LTL."],
  [null, null, null, null, null],
  ["Key output", "Value", "Formula/source", "Interpretation", "Flag"],
  ["Headline TAM ($B)", null, "Mgmt cited opportunity", "Broad market headline", "Source-backed"],
  ["Base serviceable SAM ($B)", null, "TAM_to_SAM total", "Estimated serviceable pool", "Assumption-backed"],
  ["Low / high serviceable SAM ($B)", null, "TAM_to_SAM total", "Sensitivity range", "Assumption-backed"],
  ["Base 2029 healthcare revenue needed ($B)", null, "Required_Share base case", "Revenue to support CAGR scenario", "Scenario-backed"],
  ["Base 2029 required share of base SAM", null, "Required_Share base case", "Right-to-win hurdle", "Scenario-backed"],
  ["Main public data gap", "No named, revenue-sized FDXF healthcare customer win found in public search.", "Customer_Wins", "Requires management diligence / customer references.", "Data gap"]
], { freezeRows: 4 });

exec.getRange("A1:E1").merge();
exec.getRange("A1:E1").format = { fill: "#0B1F33", font: { bold: true, color: "#FFFFFF", size: 15 } };
exec.getRange("A1:A18").format.columnWidth = 34;
exec.getRange("B1:B18").format.columnWidth = 64;
exec.getRange("C1:C18").format.columnWidth = 24;
exec.getRange("D1:D18").format.columnWidth = 28;
exec.getRange("E1:E18").format.columnWidth = 58;
exec.getRange("C5").setNumberFormat("$0.0B");
exec.getRange("B13").formulas = [["='Mgmt_TAM'!D2"]];
exec.getRange("B14").formulas = [["='TAM_to_SAM'!J8"]];
exec.getRange("B15").formulas = [["=TEXT('TAM_to_SAM'!I8,\"$0.0B\")&\" / \"&TEXT('TAM_to_SAM'!K8,\"$0.0B\")"]];
exec.getRange("B16").formulas = [["='Required_Share'!H7"]];
exec.getRange("B17").formulas = [["='Required_Share'!M7"]];
setNumberFormat(exec, "B13:B14", "$0.0B");
setNumberFormat(exec, "B16:B16", "$0.00B");
setNumberFormat(exec, "B17:B17", "0%");

const mgmt = addSheet("Mgmt_TAM", [
  ["Source_ID", "Source", "Management / public evidence", "TAM_or_revenue_$B", "Definition", "Services included", "Geography", "Time horizon", "Existing vs incremental", "Assumed FDXF penetration", "Implied revenue contribution", "Source_URL", "Confidence"],
  ["FDX_INV_DAY_P44", "FedEx Freight Investor Day p.44", "Management says it will use FedEx Custom Critical to lean more heavily into an approximately $6B healthcare, pharma and life-sciences opportunity where reliability and time-definite solutions matter.", 6.0, "Third-party estimate of total market size incorporating census commodity-flow data.", "Healthcare, pharma, life sciences; specifically tied to Custom Critical and time-definite/reliability.", "Not explicitly stated; modeled as North America / FedEx Freight-relevant opportunity.", "Medium-term strategy context.", "Not disclosed as existing revenue; treated as opportunity pool.", "Not disclosed.", "Not disclosed; workbook scenarios estimate required share.", "https://d1io3yog0oux5.cloudfront.net/_5705b101ff53031529c842d008f96e5d/fedexfreight/db/3570/34491/presentation/FedEx+Freight+Investor+Day+Presentation.pdf", "High for quote; medium for market definition."],
  ["FDX_INV_DAY_P13", "FedEx Freight Investor Day p.13", "Medium-term revenue growth target is 4%-6% CAGR.", null, "Company-wide FedEx Freight target, not healthcare-specific.", "All FedEx Freight revenue.", "Company-wide.", "Medium-term.", "Growth target from FY26E base.", "Not healthcare-specific.", "Used to calculate required healthcare contribution.", "https://d1io3yog0oux5.cloudfront.net/_5705b101ff53031529c842d008f96e5d/fedexfreight/db/3570/34491/presentation/FedEx+Freight+Investor+Day+Presentation.pdf", "High"],
  ["FDX_INV_DAY_P35", "FedEx Freight Investor Day p.35", "FY26E revenue by offering is 64% Priority, 32% Economy, 3% Other; Other includes Custom Critical, Freight Direct and specialty services.", null, "Offering mix.", "Priority, Economy, Other.", "Company-wide.", "FY2026 estimate.", "Existing revenue mix.", "Custom Critical embedded in Other; exact healthcare exposure not disclosed.", "Not disclosed.", "https://d1io3yog0oux5.cloudfront.net/_5705b101ff53031529c842d008f96e5d/fedexfreight/db/3570/34491/presentation/FedEx+Freight+Investor+Day+Presentation.pdf", "High"],
  ["FDX_Q4_FY26", "FY2026 results release", "Full fiscal 2026 revenue was $8.8B.", 8.8, "FedEx Freight segment results as previously released by FedEx Corporation.", "All FedEx Freight segment revenue.", "Company-wide.", "FY2026.", "Revenue base for medium-term scenario math.", "Not healthcare-specific.", "Scenario base year.", "https://ir.fedexfreight.com/news-events/press-releases/detail/185/fedex-freight-reports-fourth-quarter-and-full-fiscal-year-2026-financial-results", "High"],
  ["PUBLIC_SCAN", "Public search note", "No public, revenue-sized sell-side estimate of healthcare revenue contribution was identified in the source scan.", null, "Data gap.", "N/A", "N/A", "2021-2026 public record searched.", "N/A", "N/A", "Workbook uses explicit analyst assumptions for healthcare contribution share.", "N/A", "Medium"]
], { freezeRows: 1 });
setNumberFormat(mgmt, "D2:D6", "$0.0B");

const tam = addSheet("TAM_to_SAM", [
  ["Category", "Headline_TAM_$B", "LTL_low", "LTL_base", "LTL_high", "FDXF_compat_low", "FDXF_compat_base", "FDXF_compat_high", "SAM_low_$B", "SAM_base_$B", "SAM_high_$B", "Parcel_base", "Dedicated_TL_base", "Specialized_cold_chain_base", "Expedited_CC_base", "Rationale", "Key_source_ids"],
  ...tamRows,
  ["Total", null, null, null, null, null, null, null, null, null, null, null, null, null, null, "Totals are formula-backed. Percent assumptions are intentionally ranges, not false precision.", "See Sources"]
], { freezeRows: 1 });
tam.getRange("I2").formulas = [["=B2*C2*F2"]];
tam.getRange("J2").formulas = [["=B2*D2*G2"]];
tam.getRange("K2").formulas = [["=B2*E2*H2"]];
tam.getRange("I2:K7").fillDown();
tam.getRange("B8").formulas = [["=SUM(B2:B7)"]];
tam.getRange("I8").formulas = [["=SUM(I2:I7)"]];
tam.getRange("J8").formulas = [["=SUM(J2:J7)"]];
tam.getRange("K8").formulas = [["=SUM(K2:K7)"]];
setNumberFormat(tam, "B2:B8", "$0.0B");
setNumberFormat(tam, "C2:H8", "0%");
setNumberFormat(tam, "I2:K8", "$0.00B");
setNumberFormat(tam, "L2:O8", "0%");
tam.getRange("A8:Q8").format = { fill: "#EAF2F8", font: { bold: true } };

const reqRows = [];
for (const scenario of [
  ["Bear", 0.04, 0.15, "Healthcare is a modest growth contributor; easier to defend but less transformative."],
  ["Base", 0.05, 0.25, "Meaningful contribution; plausible only with visible Custom Critical / specialty wins."],
  ["Bull", 0.06, 0.40, "Aggressive contribution; difficult without evidence of capability expansion and named wins."]
]) {
  for (const year of [2027, 2028, 2029]) {
    reqRows.push([scenario[0], year, 8.8, scenario[1], null, null, scenario[2], null, null, null, null, null, null, null, scenario[3]]);
  }
}
const req = addSheet("Required_Share", [
  ["Scenario", "Year", "FY2026_revenue_base_$B", "Revenue_CAGR", "Projected_revenue_$B", "Incremental_vs_FY2026_$B", "Healthcare_contribution_pct", "Required_healthcare_revenue_$B", "SAM_low_$B", "SAM_base_$B", "SAM_high_$B", "Share_of_low_SAM", "Share_of_base_SAM", "Share_of_high_SAM", "Interpretation"],
  ...reqRows
], { freezeRows: 1 });
req.getRange("E2").formulas = [["=C2*(1+D2)^(B2-2026)"]];
req.getRange("F2").formulas = [["=E2-C2"]];
req.getRange("H2").formulas = [["=F2*G2"]];
req.getRange("I2").formulas = [["='TAM_to_SAM'!$I$8"]];
req.getRange("J2").formulas = [["='TAM_to_SAM'!$J$8"]];
req.getRange("K2").formulas = [["='TAM_to_SAM'!$K$8"]];
req.getRange("L2").formulas = [["=H2/I2"]];
req.getRange("M2").formulas = [["=H2/J2"]];
req.getRange("N2").formulas = [["=H2/K2"]];
for (const col of ["E", "F", "H", "I", "J", "K", "L", "M", "N"]) {
  req.getRange(`${col}2:${col}10`).fillDown();
}
setNumberFormat(req, "C2:C10", "$0.0B");
setNumberFormat(req, "D2:D10", "0%");
setNumberFormat(req, "E2:F10", "$0.00B");
setNumberFormat(req, "G2:G10", "0%");
setNumberFormat(req, "H2:K10", "$0.00B");
setNumberFormat(req, "L2:N10", "0%");

addSheet("Competitor_Matrix", [
  ["Provider", "Relevant business", "Healthcare logistics revenue / scale", "Facilities / cold-chain footprint", "Transport capability", "Visibility / quality system", "Recent healthcare investment or acquisition", "Customer / win evidence", "Implication for FDXF", "Source_IDs", "Source_URLs"],
  ["FedEx Freight / Custom Critical", "LTL, Custom Critical, Freight Direct and specialty services", "FY2026 FDXF revenue $8.8B; Custom Critical within 3% Other with Freight Direct/specialty, exact healthcare revenue not disclosed.", "Large LTL network; no public FDXF-specific count of GDP/cGMP healthcare facilities found.", "Surface Expedite, White Glove, temperature-control capability; 24/7/365 time-specific critical shipments.", "FedEx Corp healthcare tools include Surround, SenseAware and Priority Alert; FDXF-specific deployment not quantified.", "2026 strategy explicitly highlights healthcare/pharma/life sciences opportunity.", "No named revenue-sized FDXF healthcare win found in public scan.", "Real capability exists, especially for urgent and exception freight; evidence gap remains on scaled healthcare account wins.", "FDX_Q4_FY26; FDX_INV_DAY_P35; FDX_INV_DAY_P44; FDX_CUSTOM_CRITICAL; FDX_HEALTHCARE", "See Sources"],
  ["UPS Healthcare / Andlauer / Marken ecosystem", "Global healthcare logistics, parcel, cold chain, 3PL and specialized transportation", "UPS Healthcare cites 19.2M+ sq ft of cGMP/GDP-compliant healthcare distribution space globally.", "Large healthcare distribution footprint; AHG adds Canadian cold-chain and specialized transportation.", "Temperature-controlled logistics, storage/fulfillment, lab and clinical-trial logistics.", "UPS Premier, track-and-trace, global quality system.", "Agreed to acquire Andlauer Healthcare Group for CAD $2.2B / USD $1.6B in 2025.", "Acquisition itself is strong evidence of strategic commitment; customer-level revenue not disclosed in cited release.", "UPS appears ahead in dedicated healthcare infrastructure; FDXF must win on network density, critical freight and account service.", "UPS_AHG", "https://developer.ups.com/us/en/healthcare/news/press-releases/ups-to-aquire-andlauer-healthcare-group"],
  ["DHL Health Logistics", "Global life sciences and healthcare logistics across storage, fulfillment, shipping and last mile", "DHL says life sciences/healthcare contributed over EUR5B global revenue in 2024.", "Nearly 600 dedicated sites/hubs/warehouses in close to 130 countries; more than 2.5M sqm temperature-controlled warehouse space.", "Multi-temperature lanes, cold-chain capacity, vehicles, passive/active packaging; dedicated airfreight cold-chain network expanded in 2026.", "End-to-end visibility and IT systems emphasized.", "EUR2B investment by 2030; 50% allocated to the Americas.", "Strategic investment and 2026 cold-chain network expansion; customer-level revenue not disclosed in cited release.", "DHL sets a high bar for global healthcare infrastructure; FDXF opportunity likely domestic/time-critical rather than full global pharma supply chain.", "DHL_INVEST; DHL_AIR_COLD", "https://group.dhl.com/en/media-relations/press-releases/2025/dhl-group-to-invest-2-billion-in-dhl-health-logistics.html"],
  ["World Courier / Cencora", "Specialty pharma, clinical trial logistics, advanced therapies and cold chain", "World Courier cites 4,000+ team members and 120+ company-owned facilities across 50+ countries.", "22 strategic depots; Cencora says over 140 logistics/warehousing sites globally; World Courier North America network to 17 sites after announced expansion.", "Specialty cold chain, cryogenic transport, clinical trial supply and direct-to-patient capabilities.", "Real-time location monitoring and quality assurance described.", "2023 U.S. transport-station expansion in Denver, Indianapolis and San Diego.", "Strong specialty-pharma service evidence; mostly not LTL competitor in broad freight.", "World Courier competes for the most specialized/high-value portion of the $6B headline, limiting FDXF serviceable share.", "WORLD_COURIER; CENCORA_CLINICAL; WORLD_COURIER_US_EXP", "See Sources"],
  ["Traditional LTL peers", "ODFL, XPO, Saia and other national/regional LTL carriers", "Healthcare-specific revenue generally not disclosed in public sources reviewed.", "LTL terminal networks; healthcare-specific cold-chain/cGMP footprints not broadly disclosed.", "General LTL reliability, claims prevention and appointment handling.", "Carrier-specific service metrics, not healthcare-specific in this workbook.", "No material healthcare-specific acquisition/investment comparable to UPS/DHL found in source scan.", "No named healthcare wins compiled for this phase.", "These carriers pressure generic LTL pricing; FDXF differentiation depends on Custom Critical and FedEx account breadth.", "PUBLIC_SCAN", "N/A"]
], { freezeRows: 1 });

addSheet("FedEx_Capabilities", [
  ["Capability", "Designation", "Evidence", "Quantitative evidence", "Source_IDs", "Source_URL", "Open diligence item"],
  ["Headline healthcare market access", "Advantage", "Management specifically identifies healthcare/pharma/life sciences as a high-quality revenue opportunity tied to Custom Critical.", "$6B headline opportunity.", "FDX_INV_DAY_P44", "https://ir.fedexfreight.com/news-events/events-presentation/20260408-investor-day-2026", "Obtain management definition of included freight modes and geography."],
  ["Core network density", "Advantage", "FedEx Freight has a large North American LTL platform and long-tenured customer base.", "Event page cites nearly 30,000 vehicles, nearly 17,000 tractors, 40,000 team members, and 365+ locations; deck cites ~140K active customers.", "FDX_EVENT; FDX_INV_DAY_P37", "https://ir.fedexfreight.com/news-events/events-presentation/20260408-investor-day-2026", "Map healthcare shipper / consignee density against FDXF network lanes."],
  ["Custom Critical / urgent freight", "Advantage", "FedEx Custom Critical offers time-specific critical shipments 24/7/365, Surface Expedite and White Glove services.", "Service page states 24 hours a day, 365 days a year; no scheduled runs.", "FDX_CUSTOM_CRITICAL", "https://customcritical.fedex.com/us/owneroperator/overview/default.shtml", "Quantify Custom Critical revenue, healthcare mix and win rates."],
  ["Temperature control", "Partial advantage", "Custom Critical White Glove includes special handling such as temperature control; FedEx healthcare pages describe temperature-controlled options.", "No public FDXF-specific GDP/cGMP cold-chain footprint count found.", "FDX_CUSTOM_CRITICAL; FDX_HEALTHCARE", "https://images.fedex.com/en-us/healthcare.html", "Confirm validated temperature lanes, SOPs, certifications and healthcare quality systems."],
  ["Healthcare visibility tools", "Partial advantage", "FedEx Corp offers Surround, SenseAware and Priority Alert for monitoring/intervention.", "Near real-time / real-time visibility described, but FDXF-specific penetration not quantified.", "FDX_HEALTHCARE", "https://images.fedex.com/en-us/healthcare.html", "Confirm whether FDXF healthcare freight uses these tools routinely."],
  ["Public customer proof", "Disadvantage / data gap", "No named, revenue-sized FedEx Freight healthcare win identified in the public 2021-2026 source scan.", "N/A", "PUBLIC_SCAN", "N/A", "Ask management for named references, pipeline conversion and retained-account examples."],
  ["Competitive infrastructure", "Disadvantage vs UPS/DHL/World Courier", "Competitors disclose larger, healthcare-specific cold-chain and GDP/cGMP footprints.", "UPS 19.2M+ sq ft; DHL nearly 600 sites and >2.5M sqm temperature-controlled warehouse space; World Courier 120+ facilities.", "UPS_AHG; DHL_INVEST; WORLD_COURIER", "See Sources", "Determine whether FDXF is targeting a narrower domestic LTL/time-critical niche rather than end-to-end pharma logistics."]
], { freezeRows: 1 });

addSheet("Customer_Wins", [
  ["Company", "Date", "Customer disclosed?", "Customer / counterparty", "Vertical", "Service / transaction", "Geography", "Size disclosed", "Evidence type", "FDXF relevance", "Source_IDs", "Source_URL", "Notes"],
  ["FedEx Freight / Custom Critical", "2026-04-08", "No", "Not disclosed", "Healthcare, pharma, life sciences", "Management target opportunity tied to Custom Critical.", "Not disclosed", "$6B headline TAM, not a win size.", "Management strategy statement", "High as strategy; low as customer proof.", "FDX_INV_DAY_P44", "https://ir.fedexfreight.com/news-events/events-presentation/20260408-investor-day-2026", "This is not a named customer win."],
  ["FedEx Corp healthcare", "Accessed 2026-08-11", "No", "Not disclosed", "Healthcare", "Surround, SenseAware, Priority Alert and temperature-controlled healthcare shipping.", "Global / U.S. service pages", "Not disclosed", "Capability evidence", "Indirect; not FDXF-specific.", "FDX_HEALTHCARE", "https://images.fedex.com/en-us/healthcare.html", "Useful to contradict pure-capability bearish thesis, but not revenue proof."],
  ["FedEx Freight / Custom Critical", "2021-2026 public scan", "No", "No named revenue-sized win found", "Healthcare", "N/A", "N/A", "N/A", "Data gap", "Important FDXF diligence gap.", "PUBLIC_SCAN", "N/A", "Do not interpret absence of public wins as absence of private contracts."],
  ["UPS Healthcare", "2025-04-24", "Counterparty disclosed", "Andlauer Healthcare Group", "Healthcare cold chain / 3PL", "Agreement to acquire AHG.", "North America / Canada", "CAD $2.2B / USD $1.6B transaction value.", "Acquisition", "Competitor benchmark.", "UPS_AHG", "https://developer.ups.com/us/en/healthcare/news/press-releases/ups-to-aquire-andlauer-healthcare-group", "Shows competitor investment in specialized healthcare logistics."],
  ["DHL Health Logistics", "2025-04-07", "No named customer", "N/A", "Life sciences and healthcare", "EUR2B investment by 2030.", "Global; 50% Americas.", "EUR2B investment; >EUR5B 2024 sector revenue.", "Investment", "Competitor benchmark.", "DHL_INVEST", "https://group.dhl.com/en/media-relations/press-releases/2025/dhl-group-to-invest-2-billion-in-dhl-health-logistics.html", "Shows scale of incumbent healthcare infrastructure."],
  ["World Courier / Cencora", "2023-12-19", "No named customer", "N/A", "Specialty pharmaceuticals", "Three new U.S. transport stations.", "Denver, Indianapolis, San Diego", "North America network to 17 sites after expansion.", "Capacity expansion", "Competitor benchmark.", "WORLD_COURIER_US_EXP", "https://www.cencora.com/newsroom/world-courier-to-expand-storage-and-cold-chain-capabilities-with-new-transport-stations-in-us", "Shows high-end specialty cold-chain competition."]
], { freezeRows: 1 });

addSheet("Sources", [
  ["Source_ID", "Title", "Publisher", "Date", "URL", "Type", "Used_for", "Notes"],
  ...sources
], { freezeRows: 1 });

addSheet("Data_Dictionary", [
  ["Sheet", "Field", "Definition", "Units / format", "Formula / derivation", "Source / assumption", "Notes"],
  ["Mgmt_TAM", "TAM_or_revenue_$B", "Management-cited market size or FedEx Freight revenue base.", "$B", "Entered from cited source.", "Source-backed", "Blank when no number is disclosed."],
  ["TAM_to_SAM", "Headline_TAM_$B", "Allocated portion of the $6B management headline TAM.", "$B", "Analyst allocation; total equals $6B.", "Assumption constrained to management headline", "Categories are modeling buckets, not management-disclosed buckets."],
  ["TAM_to_SAM", "LTL_low/base/high", "Share of category plausibly serviceable by LTL or LTL-adjacent freight rather than parcel, dedicated TL or specialty courier.", "%", "Scenario assumption.", "Analyst assumption", "Lower for biologics/diagnostics; higher for devices and supplies."],
  ["TAM_to_SAM", "FDXF_compat_low/base/high", "Share of LTL-compatible freight plausibly compatible with FedEx Freight / Custom Critical capabilities.", "%", "Scenario assumption.", "Analyst assumption informed by public capabilities", "Does not equal expected market share."],
  ["TAM_to_SAM", "SAM_low/base/high_$B", "Estimated serviceable available market for FDXF capabilities.", "$B", "Headline_TAM_$B * LTL_% * FDXF_compat_%", "Formula", "Low/base/high sensitivity."],
  ["Required_Share", "Revenue_CAGR", "FedEx Freight medium-term revenue growth target scenario.", "%", "Bear 4%, Base 5%, Bull 6%.", "Source-backed range; midpoint assumption", "Management discloses 4%-6%, not the midpoint."],
  ["Required_Share", "Healthcare_contribution_pct", "Assumed share of total incremental FedEx Freight revenue growth that must come from healthcare.", "%", "Bear 15%, Base 25%, Bull 40%.", "Analyst assumption", "No public vertical-specific sell-side estimate found."],
  ["Required_Share", "Required_healthcare_revenue_$B", "Healthcare revenue needed in that year under the scenario.", "$B", "(Projected revenue - FY2026 revenue base) * healthcare contribution pct", "Formula", "Incremental revenue contribution, not total healthcare revenue."],
  ["Required_Share", "Share_of_base_SAM", "Required healthcare revenue divided by base serviceable SAM.", "%", "Required_healthcare_revenue_$B / SAM_base_$B", "Formula", "Key right-to-win hurdle."],
  ["Competitor_Matrix", "Healthcare logistics revenue / scale", "Publicly disclosed competitor scale indicator.", "Text / $ / sq ft", "Entered from sources.", "Source-backed where available", "UNKNOWN if not disclosed."],
  ["FedEx_Capabilities", "Designation", "Analyst classification of FedEx relative strength.", "Advantage / partial advantage / disadvantage / data gap", "Qualitative synthesis of sources.", "Analyst judgment", "Designed to avoid overstating precision."],
  ["Customer_Wins", "FDXF relevance", "How directly the evidence supports FedEx Freight healthcare revenue capture.", "Text", "Analyst classification.", "Analyst judgment", "Capability evidence is separated from named customer wins."]
], { freezeRows: 1 });

// Render a preview as a smoke test of the workbook surface.
const preview = await wb.render({
  sheetName: "Executive_Summary",
  autoCrop: "all",
  scale: 1,
  format: "png",
});
await fs.writeFile(`${outputDir}/Executive_Summary_preview.png`, new Uint8Array(await preview.arrayBuffer()));

const xlsx = await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(outputPath);
console.log(outputPath);
