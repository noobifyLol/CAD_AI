import glob
import pandas as pd

for f in glob.glob("outputs/phase1b_ltl_peer_panel/sources/ODFL_*.htm")[:3]:
    print("\nFILE", f)
    for i, t in enumerate(pd.read_html(f)):
        text = " ".join(t.astype(str).fillna("").values.ravel())
        if "Operating Statistics" in text or "LTL shipments per day" in text:
            print("table", i, t.shape)
            for _, row in t.iterrows():
                vals = [str(x) for x in row.tolist() if str(x) != "nan"]
                s = " | ".join(vals)
                if any(k in s for k in [
                    "Work days",
                    "Operating ratio",
                    "LTL tonnage per day",
                    "LTL shipments per day",
                    "LTL revenue per hundredweight",
                    "LTL revenue per shipment",
                    "LTL weight per shipment",
                ]):
                    print(s[:500])
