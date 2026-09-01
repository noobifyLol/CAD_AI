from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

OUT = Path("outputs/phase2b_healthcare_tam_som")
RAW = OUT / "cfs_raw"


def load_table(table: str) -> pd.DataFrame:
    path = RAW / table / f"{table}.dat"
    df = pd.read_csv(path, sep="|", dtype=str)
    df.columns = [c.lstrip("#") for c in df.columns]
    for col in ["COMM", "DMODE", "SHIPWT", "SHIPDIST", "NAICS2017"]:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
    for col in ["VAL", "TON", "AVGMILE", "VAL_S", "TON_S", "AVGMILE_S"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df.insert(0, "Source_Table", table)
    return df


def records(df: pd.DataFrame, cols: list[str]) -> list[dict]:
    keep = [c for c in cols if c in df.columns]
    out = df[keep].copy()
    out = out.where(pd.notna(out), None)
    return out.to_dict(orient="records")


tables = {name: load_table(name) for name in [
    "CF2200A09",
    "CF2200A10",
    "CF2200A18",
    "CF2200A19",
    "CF2200A20",
    "CF2200TC05",
    "CF2200TC06",
    "CF2200TC09",
]}

health_comm = ["21", "38"]
health_naics = ["4242", "4234"]
headline_tam_m = 6000.0
fdxf_2026_revenue_m = 8800.0

a10 = tables["CF2200A10"]
tc06 = tables["CF2200TC06"]

headline_goods_m = float(a10[(a10.COMM.isin(health_comm)) & (a10.DMODE == "00") & (a10.SHIPWT == "01")]["VAL"].sum())
implied_freight_rate = headline_tam_m / headline_goods_m
core_goods_m = float(a10[(a10.COMM.isin(health_comm)) & (a10.DMODE == "111") & (a10.SHIPWT.isin(["04", "05", "06", "07"]))]["VAL"].sum())
core_sam_m = core_goods_m * implied_freight_rate
cc_goods_m = float(tc06[(tc06.COMM.isin(health_comm)) & (tc06.DMODE == "111")]["VAL"].sum())
core_cc_goods_m = core_goods_m + cc_goods_m
core_cc_sam_m = core_cc_goods_m * implied_freight_rate

def get_val(df, **filters):
    x = df.copy()
    for k, v in filters.items():
        if isinstance(v, (list, tuple, set)):
            x = x[x[k].isin(v)]
        else:
            x = x[x[k] == v]
    return float(x["VAL"].sum())


mode_rows = []
for comm in health_comm + ["combined"]:
    if comm == "combined":
        base = a10[(a10.COMM.isin(health_comm)) & (a10.SHIPWT == "01")]
        label = "Healthcare proxy: Pharmaceutical products + Precision instruments"
    else:
        base = a10[(a10.COMM == comm) & (a10.SHIPWT == "01")]
        label = base["COMM_LABEL"].dropna().iloc[0]
    total = float(base[base.DMODE == "00"]["VAL"].sum())
    for _, r in base[base.DMODE.isin(["00", "11", "111", "112", "14", "21", "22", "30"])].sort_values("DMODE").iterrows():
        mode_rows.append({
            "Commodity_Code": comm,
            "Commodity_Label": label,
            "Mode_Code": r["DMODE"],
            "Mode_Label": r["DMODE_LABEL"],
            "Value_$M": r["VAL"],
            "Tons_000": r["TON"],
            "Average_Miles": r.get("AVGMILE"),
            "Share_of_Total_Value": (r["VAL"] / total) if total else None,
            "Source_Table": "CF2200A10",
        })

weight_groups = [
    ("<100 lb", ["02", "03"], "Not naturally FDXF-addressable", "Parcel/small-package weight range; CFS still includes truck movements but weight is below FedEx freight threshold."),
    ("100-499 lb", ["04"], "Partial / edge LTL", "CFS bucket includes 100-149 lb, below FedEx's typical freight threshold, but 150-499 lb can be LTL/freight."),
    ("500-999 lb", ["05", "06"], "Core LTL-compatible", "Within FedEx LTL weight guidance and plausibly palletized freight."),
    ("1,000-4,999 lb", [], "Not separately observable", "Requested split is unavailable in CFS final table; Census combines 1,000-9,999 lb."),
    ("5,000-9,999 lb", [], "Not separately observable", "Requested split is unavailable in CFS final table; Census combines 1,000-9,999 lb."),
    ("1,000-9,999 lb (CFS observed)", ["07"], "Core LTL-compatible", "Observed CFS bucket; within FedEx LTL weight guidance though cannot split requested sub-buckets."),
    ("10,000+ lb", ["08", "09", "10"], "Mostly not natural core LTL", "Includes shipments above FedEx's 15,000 lb LTL guideline and truckload-heavy movements; some 10,000-14,999 lb may be LTL but cannot be separated."),
]

weight_rows = []
for comm in health_comm + ["combined"]:
    label = "Healthcare proxy: Pharmaceutical products + Precision instruments" if comm == "combined" else a10[a10.COMM == comm]["COMM_LABEL"].dropna().iloc[0]
    for mode, mode_label in [("00", "All modes"), ("11", "Truck"), ("111", "For-hire truck"), ("21", "Parcel, U.S.P.S. or courier")]:
        base = a10[(a10.DMODE == mode) & (a10.COMM.isin(health_comm) if comm == "combined" else a10.COMM.eq(comm))]
        total = float(base[base.SHIPWT == "01"]["VAL"].sum())
        for bucket, codes, address, note in weight_groups:
            val = float(base[base.SHIPWT.isin(codes)]["VAL"].sum()) if codes else None
            tons = float(base[base.SHIPWT.isin(codes)]["TON"].sum()) if codes else None
            weight_rows.append({
                "Commodity_Code": comm,
                "Commodity_Label": label,
                "Mode_Code": mode,
                "Mode_Label": mode_label,
                "Requested_Weight_Bucket": bucket,
                "CFS_Bucket_Codes": ",".join(codes) if codes else "N/A",
                "Value_$M": val,
                "Tons_000": tons,
                "Share_of_Mode_Value": (val / total) if val is not None and total else None,
                "Addressability": address,
                "Notes": note,
                "Source_Table": "CF2200A10",
            })

dist_rows = []
a09 = tables["CF2200A09"]
for comm in health_comm + ["combined"]:
    label = "Healthcare proxy: Pharmaceutical products + Precision instruments" if comm == "combined" else a09[a09.COMM == comm]["COMM_LABEL"].dropna().iloc[0]
    for mode, mode_label in [("00", "All modes"), ("11", "Truck"), ("111", "For-hire truck"), ("21", "Parcel, U.S.P.S. or courier")]:
        base = a09[(a09.DMODE == mode) & (a09.COMM.isin(health_comm) if comm == "combined" else a09.COMM.eq(comm))]
        total = float(base[base.SHIPDIST == "001"]["VAL"].sum())
        for _, r in base[base.SHIPDIST != "001"].sort_values("SHIPDIST").iterrows():
            dist_rows.append({
                "Commodity_Code": comm,
                "Commodity_Label": label,
                "Mode_Code": mode,
                "Mode_Label": mode_label,
                "Distance_Code": r["SHIPDIST"],
                "Distance_Bucket": r["SHIPDIST_LABEL"],
                "Value_$M": r["VAL"],
                "Tons_000": r["TON"],
                "Share_of_Mode_Value": (r["VAL"] / total) if total else None,
                "Source_Table": "CF2200A09",
            })

temp_rows = []
tc05 = tables["CF2200TC05"]
for comm in ["21", "38", "384"]:
    source_df = tc05[tc05.COMM == comm]
    for _, r in source_df.iterrows():
        temp_rows.append({
            "Commodity_Code": r["COMM"],
            "Commodity_Label": r["COMM_LABEL"],
            "Mode_Code": "All",
            "Mode_Label": "All modes",
            "Temperature_Controlled_Value_$M": r["VAL"],
            "Temperature_Controlled_Tons_000": r["TON"],
            "Average_Miles": r.get("AVGMILE"),
            "Source_Table": "CF2200TC05",
        })
for comm in health_comm:
    for _, r in tc06[(tc06.COMM == comm) & (tc06.DMODE.isin(["00", "11", "111", "112", "14", "21", "22"]))].sort_values(["COMM", "DMODE"]).iterrows():
        temp_rows.append({
            "Commodity_Code": r["COMM"],
            "Commodity_Label": r["COMM_LABEL"],
            "Mode_Code": r["DMODE"],
            "Mode_Label": r["DMODE_LABEL"],
            "Temperature_Controlled_Value_$M": r["VAL"],
            "Temperature_Controlled_Tons_000": r["TON"],
            "Average_Miles": r.get("AVGMILE"),
            "Source_Table": "CF2200TC06",
        })

ltl_addressability = [
    {
        "Bucket": "Headline TAM reconciliation denominator",
        "Observed_Goods_Value_$M": headline_goods_m,
        "Implied_Freight_Revenue_$M": headline_tam_m,
        "Implied_Freight_Revenue_as_%_Goods_Value": implied_freight_rate,
        "Observed_basis": "CFS all-mode commodity value for SCTG 21 + SCTG 38.",
        "Addressability": "Headline / broad observed denominator",
        "Caveat": "CFS reports goods value, not transportation revenue; $6B cannot be directly replicated without a third-party freight-spend yield.",
    },
    {
        "Bucket": "A. Core LTL-compatible",
        "Observed_Goods_Value_$M": core_goods_m,
        "Implied_Freight_Revenue_$M": core_sam_m,
        "Implied_Freight_Revenue_as_%_Goods_Value": implied_freight_rate,
        "Observed_basis": "For-hire truck, SCTG 21 + 38, shipment weight 100-9,999 lb.",
        "Addressability": "Core LTL-compatible",
        "Caveat": "100-499 lb bucket includes 100-149 lb below freight threshold; 1,000-9,999 cannot be split into requested sub-buckets.",
    },
    {
        "Bucket": "B. Custom Critical / specialty-compatible",
        "Observed_Goods_Value_$M": cc_goods_m,
        "Implied_Freight_Revenue_$M": cc_goods_m * implied_freight_rate,
        "Implied_Freight_Revenue_as_%_Goods_Value": implied_freight_rate,
        "Observed_basis": "Temperature-controlled for-hire truck value for SCTG 21 + 38.",
        "Addressability": "Custom Critical / specialty-compatible",
        "Caveat": "Temperature control can overlap with core LTL weight buckets; use as incremental upper-bound component unless overlap is sourced.",
    },
    {
        "Bucket": "A+B. Core LTL + Custom Critical upper bound",
        "Observed_Goods_Value_$M": core_cc_goods_m,
        "Implied_Freight_Revenue_$M": core_cc_sam_m,
        "Implied_Freight_Revenue_as_%_Goods_Value": implied_freight_rate,
        "Observed_basis": "Core LTL goods value plus temperature-controlled for-hire truck goods value.",
        "Addressability": "Observable upper-bound SAM proxy",
        "Caveat": "Not de-duplicated because CFS does not cross-tab shipment weight and temperature control in TC06.",
    },
]

sens_rows = []
for vertical_ppt in [0.005, 0.010, 0.015]:
    vertical_revenue = fdxf_2026_revenue_m * ((1 + vertical_ppt) ** 3 - 1)
    for hc_alloc in [0.25, 0.50, 0.67, 0.75]:
        hc_rev = vertical_revenue * hc_alloc
        share_headline = hc_rev / headline_tam_m
        share_core = hc_rev / core_sam_m
        share_corecc = hc_rev / core_cc_sam_m
        def label(x):
            if x < 0.05:
                return "TRIVIAL"
            if x < 0.10:
                return "PLAUSIBLE"
            if x < 0.20:
                return "DEMANDING"
            return "AGGRESSIVE"
        sens_rows.append({
            "Vertical_CAGR_Contribution_ppt": vertical_ppt,
            "Healthcare_Allocation_of_New_Verticals": hc_alloc,
            "2029_Incremental_Vertical_Revenue_$M": vertical_revenue,
            "2029_Healthcare_Revenue_$M": hc_rev,
            "Required_%_$6B_Headline_TAM": share_headline,
            "Required_%_Core_LTL_SAM": share_core,
            "Required_%_Core_LTL_plus_CC_SAM": share_corecc,
            "Headline_Label": label(share_headline),
            "Core_LTL_Label": label(share_core),
            "Core_plus_CC_Label": label(share_corecc),
        })

raw_cols = ["Source_Table", "COMM", "COMM_LABEL", "NAICS2017", "NAICS2017_LABEL", "DMODE", "DMODE_LABEL", "SHIPDIST", "SHIPDIST_LABEL", "SHIPWT", "SHIPWT_LABEL", "YEAR", "VAL", "TON", "AVGMILE", "VAL_S", "TON_S", "AVGMILE_S"]
raw_extract = []
for t, df in tables.items():
    mask = pd.Series(False, index=df.index)
    if "COMM" in df.columns:
        mask |= df["COMM"].isin(["21", "38", "384"])
    if "NAICS2017" in df.columns:
        mask |= df["NAICS2017"].isin(health_naics)
    # Keep broad all-commodity totals for context in raw tab.
    if "COMM" in df.columns:
        mask |= df["COMM"].eq("0000")
    if "NAICS2017" in df.columns:
        mask |= df["NAICS2017"].eq("00")
    sample = df[mask].copy()
    if len(sample) > 800:
        sample = sample.head(800)
    raw_extract.extend(records(sample, raw_cols))

commodity_map = [
    ["SCTG", "21", "Pharmaceutical products", "Include", "Narrow healthcare commodity. Directly cited in user brief and CFS labels.", "GAS09/GAS10/TC05/TC06"],
    ["SCTG", "38", "Precision instruments and apparatus", "Include as broad observed proxy", "Contains medical/scientific instruments, but also non-medical precision instruments; use as an upper-bound healthcare/life-sciences proxy.", "GAS09/GAS10/TC05/TC06"],
    ["SCTG", "384", "Medical, surgical, dental, veterinary or similar instruments", "Include where available", "Available in temperature-control table at 3-digit level; not available in GAS09/GAS10 final tables.", "TC05"],
    ["NAICS", "4242", "Drugs and druggists' sundries merchant wholesalers", "Include", "Direct healthcare distribution industry.", "GAS18/GAS19/GAS20/TC09"],
    ["NAICS", "4234", "Professional and commercial equipment and supplies merchant wholesalers", "Include as broad observed proxy", "Broad industry includes professional/scientific/medical equipment and supplies, but not exclusively healthcare.", "GAS18/GAS19/GAS20/TC09"],
    ["SCTG", "23 / 40", "Other chemicals / miscellaneous manufactured products", "Exclude", "Potentially contains lab supplies or healthcare items but not specific enough in prioritized final tables.", "CFS labels too broad"],
]

data = {
    "meta": {
        "headline_tam_m": headline_tam_m,
        "fdxf_2026_revenue_m": fdxf_2026_revenue_m,
        "headline_goods_value_m": headline_goods_m,
        "implied_freight_rate": implied_freight_rate,
        "core_goods_value_m": core_goods_m,
        "core_sam_m": core_sam_m,
        "cc_goods_value_m": cc_goods_m,
        "cc_sam_m": cc_goods_m * implied_freight_rate,
        "core_cc_goods_value_m": core_cc_goods_m,
        "core_cc_sam_m": core_cc_sam_m,
        "cfs_download_url": "https://www2.census.gov/programs-surveys/cfs/data/2022/",
    },
    "commodity_map": commodity_map,
    "cfs_raw": raw_extract,
    "mode_share": mode_rows,
    "shipment_weight": weight_rows,
    "distance_distribution": dist_rows,
    "temp_control": temp_rows,
    "ltl_addressability": ltl_addressability,
    "required_sensitivity": sens_rows,
}

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "phase2b_processed_data.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
print(json.dumps(data["meta"], indent=2))
