"""Builds dist/Flexi Pension drawdown calculator.xlsx from data/rates.json.

Every rate in the workbook comes from rates.json, so a new PDS means editing one file
and re-running this script. The workbook has no macros: all logic is plain formulas.

Run:  python -I companion/tools/build_workbook.py
"""
import json
import pathlib
import sys

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Protection, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = pathlib.Path(__file__).resolve().parent.parent
rates_doc = json.loads((ROOT / "data" / "rates.json").read_text(encoding="utf-8"))
sources = {d["id"]: d for d in json.loads((ROOT / "data" / "sources.json").read_text(encoding="utf-8"))["documents"]}
rate = {r["id"]: r for r in rates_doc["rates"]}
assumptions = {a["id"]: a for a in json.loads((ROOT / "data" / "assumptions.json").read_text(encoding="utf-8"))["items"]}
bands = rates_doc["tables"]["minimum_drawdown"]["rows"]
pres = rates_doc["tables"]["preservation_age"]["rows"]

OUT = ROOT / "dist" / "Flexi Pension drawdown calculator.xlsx"
OUT.parent.mkdir(parents=True, exist_ok=True)

# ---- styles -----------------------------------------------------------------
NAVY = "1F3A5F"
INPUT_FILL = PatternFill("solid", fgColor="FFF4CC")
OUT_FILL = PatternFill("solid", fgColor="E8F1FB")
HEAD_FILL = PatternFill("solid", fgColor=NAVY)
WARN_FILL = PatternFill("solid", fgColor="FDE2E1")
OK_FILL = PatternFill("solid", fgColor="DFF3E4")
thin = Side(style="thin", color="C9D2DC")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
H1 = Font(size=16, bold=True, color=NAVY)
H2 = Font(size=12, bold=True, color=NAVY)
WHITE_BOLD = Font(bold=True, color="FFFFFF")
MUTED = Font(size=9, italic=True, color="5B6B7C")
BOLD = Font(bold=True)
MONEY = '"$"#,##0'
MONEY_C = '"$"#,##0.00'
DATE = "d mmm yyyy"
PCT = "0%"

wb = Workbook()


def abs_ref(sheet, col, row):
    return f"'{sheet}'!${col}${row}"


def define(ref_name, sheet, col, row):
    wb.defined_names[ref_name] = DefinedName(ref_name, attr_text=abs_ref(sheet, col, row))


def define_range(ref_name, sheet, c1, r1, c2, r2):
    wb.defined_names[ref_name] = DefinedName(ref_name, attr_text=f"'{sheet}'!${c1}${r1}:${c2}${r2}")


def label(ws, cell, text, font=None):
    ws[cell] = text
    if font:
        ws[cell].font = font


def inp(ws, cell, value, fmt=None):
    c = ws[cell]
    c.value = value
    c.fill = INPUT_FILL
    c.border = BOX
    if fmt:
        c.number_format = fmt
    return c


def out(ws, cell, formula, fmt=None, bold=False):
    c = ws[cell]
    c.value = formula
    c.fill = OUT_FILL
    c.border = BOX
    if fmt:
        c.number_format = fmt
    if bold:
        c.font = BOLD
    return c


def guide(dv, title, text):
    dv.promptTitle, dv.prompt, dv.showInputMessage = title[:32], text[:255], True


def validate(ws, ref, kind, title, text):
    """Adds an input prompt and rejects values that can't be right (a typo'd date, a negative balance)."""
    if kind == "date":
        dv = DataValidation(type="date", operator="between", formula1="DATE(1900,1,1)", formula2="DATE(2100,12,31)", allow_blank=True)
        dv.error = "That isn't a date Excel recognises. Type it like 14/5/1959."
    elif kind == "money":
        dv = DataValidation(type="decimal", operator="between", formula1="0", formula2="100000000", allow_blank=True)
        dv.error = "Enter the amount as a number, e.g. 500000."
    elif kind == "count":
        dv = DataValidation(type="whole", operator="between", formula1="0", formula2="400", allow_blank=True)
        dv.error = "Enter a whole number of payments."
    else:
        dv = DataValidation(type="whole", operator="between", formula1="15", formula2="120", allow_blank=True)
        dv.error = "Enter an age between 15 and 120."
    dv.errorTitle, dv.showErrorMessage = title[:32], True
    guide(dv, title, text)
    ws.add_data_validation(dv)
    dv.add(ref)


def cite(rid):
    r = rate[rid]
    d = sources[r["doc"]]
    return f'{d["title"]} ({d["issued"]}): "{r["quote"]}"'


# ---- Rates sheet (built first so names exist) ---------------------------------
rs = wb.active
rs.title = "Rates"
label(rs, "A1", "Rates and rules used by this workbook", H1)
label(rs, "A2", "Generated from companion/data/rates.json. Change rates there and rebuild, not here.", MUTED)

rs["A4"], rs["B4"], rs["C4"] = "From age", "Band", "Minimum % of balance"
for c in ("A4", "B4", "C4"):
    rs[c].font, rs[c].fill = WHITE_BOLD, HEAD_FILL
for i, b in enumerate(bands):
    r = 5 + i
    rs.cell(r, 1, b["from_age"])
    rs.cell(r, 2, b["label"])
    rs.cell(r, 3, b["pct"]).number_format = PCT
band_last = 4 + len(bands)
define_range("BandAge", "Rates", "A", 5, "A", band_last)
define_range("BandLabel", "Rates", "B", 5, "B", band_last)
define_range("BandPct", "Rates", "C", 5, "C", band_last)
md = rates_doc["tables"]["minimum_drawdown"]
label(rs, f"A{band_last + 1}", f'Source: {sources[md["doc"]]["title"]} ({sources[md["doc"]]["issued"]}), "Your income payments".', MUTED)

prow = band_last + 3
rs.cell(prow, 1, "Born before").font = WHITE_BOLD
rs.cell(prow, 2, "Preservation age").font = WHITE_BOLD
rs.cell(prow, 1).fill = rs.cell(prow, 2).fill = HEAD_FILL
import datetime as _dt

for i, p in enumerate(pres):
    r = prow + 1 + i
    born = _dt.date.fromisoformat(p["born_before"])
    # Start of range for lookup: born on or after this date -> this age.
    start = _dt.date(1900, 1, 1) if i == 0 else _dt.date.fromisoformat(pres[i - 1]["born_before"])
    rs.cell(r, 1, start).number_format = DATE
    rs.cell(r, 2, p["age"])
pres_last = prow + len(pres)
rs.cell(prow, 1).value = "Born on or after"
define_range("PresFrom", "Rates", "A", prow + 1, "A", pres_last)
define_range("PresAge", "Rates", "B", prow + 1, "B", pres_last)

scal = pres_last + 2
scalars = [
    ("MinStart", "pension_min_start", rate["pension_min_start"]["value"], MONEY),
    ("Residual", "pension_residual", rate["pension_residual"]["value"], MONEY),
    ("CloseOut", "pension_close_out", rate["pension_close_out"]["value"], MONEY),
    ("LumpMin", "pension_lump_min", rate["pension_lump_min"]["value"], MONEY),
    ("TTRMaxPct", "ttr_max_pct", rate["ttr_max_pct"]["value"], PCT),
    ("RoundTo", "min_rounding", rate["min_rounding"]["value"], MONEY),
]
rs.cell(scal, 1, "Rule").font = WHITE_BOLD
rs.cell(scal, 2, "Value").font = WHITE_BOLD
rs.cell(scal, 3, "PDS wording").font = WHITE_BOLD
for c in range(1, 4):
    rs.cell(scal, c).fill = HEAD_FILL
for i, (nm, rid, val, fmt) in enumerate(scalars):
    r = scal + 1 + i
    rs.cell(r, 1, rate[rid]["label"])
    rs.cell(r, 2, val).number_format = fmt
    rs.cell(r, 3, cite(rid)).alignment = Alignment(wrap_text=True, vertical="top")
    define(nm, "Rates", "B", r)
extra = scal + 1 + len(scalars)
for i, rid in enumerate(["ttr_max_not_prorated", "june_start", "default_frequency"]):
    r = extra + i
    rs.cell(r, 1, rate[rid]["label"])
    rs.cell(r, 2, str(rate[rid]["value"]))
    rs.cell(r, 3, cite(rid)).alignment = Alignment(wrap_text=True, vertical="top")
rs.column_dimensions["A"].width = 52
rs.column_dimensions["B"].width = 18
rs.column_dimensions["C"].width = 110

# ---- Calculator ---------------------------------------------------------------
cs = wb.create_sheet("Calculator", 0)
wb.active = 0
cs.sheet_view.showGridLines = False
cs.column_dimensions["A"].width = 3
cs.column_dimensions["B"].width = 46
cs.column_dimensions["C"].width = 22
cs.column_dimensions["D"].width = 4
cs.column_dimensions["E"].width = 70
label(cs, "B1", "Flexi Pension: minimum and maximum payments", H1)
label(cs, "B2", "Yellow cells are inputs. Blue cells are calculated. General information only: it shows the PDS arithmetic and does not recommend an amount.", MUTED)

label(cs, "B4", "Inputs", H2)
rows_in = [
    ("B5", "Date of birth", "C5", _dt.date(1959, 5, 14), DATE),
    ("B6", "Pension start date", "C6", _dt.date(2026, 10, 1), DATE),
    ("B7", "Opening balance", "C7", 500000, MONEY),
    ("B8", "Pension type", "C8", "Retirement Phase", None),
    ("B9", "Payment frequency", "C9", "Monthly", None),
    ("B10", "Chosen annual amount (optional)", "C10", None, MONEY),
    ("B11", "Date of any fortnightly payment (optional)", "C11", None, DATE),
    ("B12", "Payments left this year (optional override)", "C12", None, "0"),
    ("B13", "Or age at start (if no date of birth)", "C13", None, "0"),
]
for lc, text, vc, val, fmt in rows_in:
    label(cs, lc, text)
    inp(cs, vc, val, fmt)
dv_type = DataValidation(type="list", formula1='"Retirement Phase,TTR,Beneficiary (BIS)"', allow_blank=False)
dv_freq = DataValidation(type="list", formula1='"Fortnightly,Monthly,Quarterly,Half-yearly,Annual"', allow_blank=False)
cs.add_data_validation(dv_type)
cs.add_data_validation(dv_freq)
dv_type.add("C8")
dv_freq.add("C9")
guide(dv_type, "Pension type", "Pick from the list, or type R, T or B and press Alt+Down.")
guide(dv_freq, "Frequency", "Pick from the list. Monthly is the default if the member hasn't chosen.")
validate(cs, "C5", "date", "Date of birth", "Type it as you see it, e.g. 14/5/1959. Leave blank and use the age box below if you only know the age.")
validate(cs, "C6", "date", "Start date", "e.g. 1/10/2026. Ctrl+; enters today's date.")
validate(cs, "C7", "money", "Opening balance", "Numbers only, e.g. 500000. Commas and $ are added for you.")
validate(cs, "C10", "money", "Chosen annual amount", "Optional. The amount the member wants this year.")
validate(cs, "C11", "date", "Fortnightly payment date", "Optional. Any date a fortnightly payment was paid (from the account history). Without it, the count assumes one payment every 14 days.")
validate(cs, "C12", "count", "Payments left", "Optional. Leave blank to estimate from the frequency.")
validate(cs, "C13", "age", "Age at start", "Only used when the date of birth is blank.")
for nm, cell in [("BirthDate", "C5"), ("Start", "C6"), ("Balance", "C7"), ("PType", "C8"), ("Freq", "C9"),
                 ("Chosen", "C10"), ("Anchor", "C11"), ("PayOverride", "C12"), ("AgeIn", "C13")]:
    define(nm, "Calculator", cell[0], int(cell[1:]))
label(cs, "E5", "Example values are the PDS 'Gavin' example. Overwrite them.", MUTED)
label(cs, "E11", "Fortnightly payments are paid every second Friday. Any one past payment date pins down which Fridays; leave blank to estimate.", MUTED)
label(cs, "E12", "Leave blank to estimate from the frequency. Enter a number if the first payment falls in a later month.", MUTED)

label(cs, "B14", "This financial year", H2)
calc_rows = [
    ("Age at start", "AgeStart", '=IF(Start="","",IF(BirthDate="",IF(AgeIn="","",AgeIn),DATEDIF(BirthDate,Start,"y")))', "0"),
    ("Preservation age", "PresAgeV", '=IF(BirthDate="","",LOOKUP(BirthDate,PresFrom,PresAge))', "0"),
    ("Age band", "BandNow", '=IF(AgeStart="","",LOOKUP(AgeStart,BandAge,BandLabel))', None),
    ("Minimum percentage", "PctNow", '=IF(AgeStart="","",LOOKUP(AgeStart,BandAge,BandPct))', PCT),
    ("Financial year starts", "FYStart", '=IF(Start="","",DATE(YEAR(Start)-(MONTH(Start)<7),7,1))', DATE),
    ("Financial year ends", "FYEnd", '=IF(Start="","",DATE(YEAR(FYStart)+1,6,30))', DATE),
    ("Days in this financial year", "DaysYear", '=IF(Start="","",FYEnd-FYStart+1)', "0"),
    ("Days left, counting the start date", "DaysLeft", '=IF(Start="","",FYEnd-Start+1)', "0"),
    ("Full-year minimum", "FullMin", '=IF(PctNow="","",ROUND(Balance*PctNow/RoundTo,0)*RoundTo)', MONEY),
    ("Pro-rata minimum for the rest of this year", "ProMin", '=IF(PctNow="","",ROUND(Balance*PctNow*DaysLeft/DaysYear/RoundTo,0)*RoundTo)', MONEY),
    ("Maximum for this year", "MaxYr", '=IF(PType="TTR",Balance*TTRMaxPct,"No maximum")', MONEY),
    ("Allowed range for this year", "AllowedRange", '=IF(ProMin="","",TEXT(ProMin,"$#,##0")&IF(PType="TTR"," to "&TEXT(MaxYr,"$#,##0")," or more"))', None),
]
r = 15
for text, nm, f, fmt in calc_rows:
    label(cs, f"B{r}", text)
    out(cs, f"C{r}", f, fmt, bold=nm in ("ProMin", "MaxYr", "Range"))
    define(nm, "Calculator", "C", r)
    r += 1
label(cs, "E23", "Balance × minimum percentage, rounded to the nearest $10.", MUTED)
label(cs, "E24", "Days left ÷ days in year × full-year amount, rounded to the nearest $10 (PDS 'Gavin' example).", MUTED)
label(cs, "E25", "TTR only: 10% of the opening balance, not pro-rated.", MUTED)

r += 1
label(cs, f"B{r}", "Payments", H2)
r += 1
pay_start = r
# Position of a month in the financial year: July = 1 ... June = 12
ps = "(MOD(MONTH(Start)-7,12)+1)"
first_fn = "(Anchor-14*INT((Anchor-Start)/14))"
pay_rows = [
    ("Payments left this year (estimate)", "PayEst",
     f'=IF(Start="","",CHOOSE(MATCH(Freq,{{"Fortnightly","Monthly","Quarterly","Half-yearly","Annual"}},0),'
     f'IF(Anchor="",ROUND((FYEnd-Start+1)/14,0),IF({first_fn}>FYEnd,0,INT((FYEnd-{first_fn})/14)+1)),'
     f'13-{ps},4-INT(({ps}-1)/3),2-INT(({ps}-1)/6),1))', "0"),
    ("Payments used below", "PayN", '=IF(PayOverride<>"",PayOverride,PayEst)', "0"),
    ("Each payment at the minimum", "PerMin", '=IF(ISNUMBER(PayN),IF(PayN>0,ROUNDUP(ProMin/PayN/RoundTo,0)*RoundTo,""),"")', MONEY),
    ("Each payment at the TTR maximum", "PerMax", '=IF(AND(PType="TTR",ISNUMBER(PayN)),IF(PayN>0,ROUNDDOWN(MaxYr/PayN/RoundTo,0)*RoundTo,""),"n/a")', MONEY),
    ("Each payment at the chosen amount", "PerChosen", '=IF(AND(Chosen<>"",ISNUMBER(PayN)),IF(PayN>0,ROUND(Chosen/PayN/RoundTo,0)*RoundTo,""),"")', MONEY),
]
for text, nm, f, fmt in pay_rows:
    label(cs, f"B{r}", text)
    out(cs, f"C{r}", f, fmt, bold=nm in ("PerMin", "PerMax", "PerChosen"))
    define(nm, "Calculator", "C", r)
    r += 1
label(cs, f"E{pay_start}", "Monthly: start month to June. Quarterly: Mar, Jun, Sep, Dec. Half-yearly: Jun, Dec. Annual: 1.", MUTED)
label(cs, f"E{pay_start + 2}", "Rounded up to $10 so the payments add up to at least the minimum.", MUTED)
label(cs, f"E{pay_start + 3}", "Rounded down to $10 so the payments stay under the maximum (PDS 'Bryn' example).", MUTED)

r += 1
label(cs, f"B{r}", "Next 1 July", H2)
r += 1
nxt = [
    ("Age on the next 1 July", "AgeNext", '=IF(OR(BirthDate="",FYEnd=""),"",DATEDIF(BirthDate,FYEnd+1,"y"))', "0"),
    ("Minimum percentage from the next 1 July", "PctNext", '=IF(AgeNext="","",LOOKUP(AgeNext,BandAge,BandPct))', PCT),
    ("Change", "PctChange", '=IF(PctNext="","",IF(PctNext>PctNow,"Steps up from "&TEXT(PctNow,"0%")&" to "&TEXT(PctNext,"0%"),"No change"))', None),
]
for text, nm, f, fmt in nxt:
    label(cs, f"B{r}", text)
    out(cs, f"C{r}", f, fmt)
    define(nm, "Calculator", "C", r)
    r += 1
label(cs, f"E{r - 2}", "From 1 July the minimum is recalculated on the balance that day.", MUTED)

r += 1
label(cs, f"B{r}", "Checks", H2)
r += 1
warn_start = r
warnings = [
    ('=IF(Balance="","",IF(Balance<MinStart,"Below the "&TEXT(MinStart,"$#,##0")&" minimum to start a Flexi Pension.","OK: at least "&TEXT(MinStart,"$#,##0")&"."))'),
    ('=IF(OR(Start="",BirthDate=""),"",IF(Start<=BirthDate,"Start date is before the date of birth.","OK: dates are in order."))'),
    ('=IF(OR(Start="",FYStart=""),"",IF(MONTH(Start)=6,"Starts in June: the member can choose no payment until the next financial year.","Not a June start."))'),
    ('=IF(OR(PType<>"TTR",AgeStart=""),"Not a TTR pension.",IF(AND(PresAgeV<>"",AgeStart<PresAgeV),"Under preservation age: a TTR pension cannot start yet.",IF(AgeStart>=65,"65 or over: TTR converts to Retirement Phase, so the 10% maximum no longer applies.","OK: TTR age rules met.")))'),
    ('=IF(OR(Chosen="",ProMin=""),"No chosen amount entered.",IF(Chosen<ProMin,"Chosen amount is below the pro-rata minimum.",IF(AND(PType="TTR",Chosen>MaxYr),"Chosen amount is above the TTR maximum.","OK: chosen amount is within the range.")))'),
    ('=IF(AND(Freq="Fortnightly",Anchor="",PayOverride=""),"Fortnightly count is an estimate (one every 14 days). Enter any fortnightly payment date for an exact count.",IF(AND(Freq="Fortnightly",Anchor<>"",WEEKDAY(Anchor)<>6),"The payment date entered is not a Friday.","OK: frequency inputs complete."))'),
    ('=IF(DaysYear=366,"This financial year has 366 days. Confirm the admin system also divides by 366.","OK: 365-day year.")'),
]
for f in warnings:
    c = cs[f"B{r}"]
    c.value = f
    c.alignment = Alignment(wrap_text=True)
    cs.merge_cells(f"B{r}:E{r}")
    r += 1
warn_rng = f"B{warn_start}:B{r - 1}"
cs.conditional_formatting.add(warn_rng, FormulaRule(formula=[f'AND(B{warn_start}<>"",LEFT(B{warn_start},2)<>"OK",LEFT(B{warn_start},3)<>"Not",LEFT(B{warn_start},2)<>"No")'], fill=WARN_FILL))
cs.conditional_formatting.add(warn_rng, FormulaRule(formula=[f'LEFT(B{warn_start},2)="OK"'], fill=OK_FILL))

r += 1
label(cs, f"B{r}", "Source: Flexi Pension PDS issued 28 September 2026, 'Your income payments' and 'Transition to retirement with a Flexi Pension'. Rates sheet quotes each rule.", MUTED)

# ---- Full table ---------------------------------------------------------------
ft = wb.create_sheet("Full table", 1)
ft.sheet_view.showGridLines = False
label(ft, "A1", "Pro-rata minimum for every start date in a financial year", H1)
label(ft, "A2", "Each cell is the minimum for the rest of the year if the pension starts on that row's date, for that age band, rounded to the nearest $10.", MUTED)
label(ft, "A4", "Financial year starting 1 July")
inp(ft, "C4", "=YEAR(FYStart)", "0")
label(ft, "A5", "Balance used")
inp(ft, "C5", "=Balance", MONEY)
label(ft, "D4", "Defaults to the Calculator. Overwrite with a year such as 2027.", MUTED)
label(ft, "D5", "Defaults to the Calculator balance. Overwrite to tabulate another balance.", MUTED)
define("FTYear", "Full table", "C", 4)
define("FTBal", "Full table", "C", 5)
label(ft, "A6", "Days in that year")
out(ft, "C6", "=DATE(FTYear+1,6,30)-DATE(FTYear,7,1)+1", "0")
define("FTDays", "Full table", "C", 6)

hdr = 8
heads = ["Start date", "Days left"] + [b["label"] for b in bands]
for i, h in enumerate(heads):
    c = ft.cell(hdr, 1 + i, h)
    c.font, c.fill = WHITE_BOLD, HEAD_FILL
    c.alignment = Alignment(horizontal="center", wrap_text=True)
for i, b in enumerate(bands):
    c = ft.cell(hdr + 1, 3 + i, b["pct"])
    c.number_format = PCT
    c.font = MUTED
    c.alignment = Alignment(horizontal="center")
ft.cell(hdr + 1, 1, "Minimum % for the band").font = MUTED
first = hdr + 2
for k in range(366):
    rr = first + k
    ft.cell(rr, 1, f'=IF(DATE(FTYear,7,1)+{k}>DATE(FTYear+1,6,30),"",DATE(FTYear,7,1)+{k})').number_format = DATE
    ft.cell(rr, 2, f'=IF(A{rr}="","",DATE(FTYear+1,6,30)-A{rr}+1)').number_format = "0"
    for i in range(len(bands)):
        col = get_column_letter(3 + i)
        ft.cell(rr, 3 + i, f'=IF(A{rr}="","",ROUND(FTBal*{col}${hdr + 1}*B{rr}/FTDays/RoundTo,0)*RoundTo)').number_format = MONEY
ft.freeze_panes = ft.cell(first, 3)
ft.column_dimensions["A"].width = 16
ft.column_dimensions["B"].width = 10
for i in range(len(bands)):
    ft.column_dimensions[get_column_letter(3 + i)].width = 13
# Highlight the Calculator's start date row.
ft.conditional_formatting.add(f"A{first}:{get_column_letter(2 + len(bands))}{first + 365}",
                              FormulaRule(formula=[f"$A{first}=Start"], fill=INPUT_FILL))

# ---- By balance ---------------------------------------------------------------
bb = wb.create_sheet("By balance", 2)
bb.sheet_view.showGridLines = False
label(bb, "A1", "Full-year minimum by balance and age band", H1)
label(bb, "A2", "For a pension that runs the whole financial year (or for the minimum from 1 July). Rounded to the nearest $10. Last column: TTR maximum.", MUTED)
heads = ["Balance"] + [b["label"] for b in bands] + ["TTR maximum (10%)"]
for i, h in enumerate(heads):
    c = bb.cell(4, 1 + i, h)
    c.font, c.fill = WHITE_BOLD, HEAD_FILL
    c.alignment = Alignment(horizontal="center", wrap_text=True)
for i, b in enumerate(bands):
    c = bb.cell(5, 2 + i, b["pct"])
    c.number_format = PCT
    c.font = MUTED
    c.alignment = Alignment(horizontal="center")
balances = [25000, 50000, 75000] + list(range(100000, 500001, 25000)) + list(range(550000, 1000001, 50000)) + list(range(1100000, 2100001, 100000))
for k, bal in enumerate(balances):
    rr = 6 + k
    bb.cell(rr, 1, bal).number_format = MONEY
    for i in range(len(bands)):
        col = get_column_letter(2 + i)
        bb.cell(rr, 2 + i, f"=ROUND($A{rr}*{col}$5/RoundTo,0)*RoundTo").number_format = MONEY
    bb.cell(rr, 2 + len(bands), f"=$A{rr}*TTRMaxPct").number_format = MONEY
bb.freeze_panes = "B6"
for i in range(len(heads)):
    bb.column_dimensions[get_column_letter(1 + i)].width = 14

# ---- Closing a pension -----------------------------------------------------------
cl = wb.create_sheet("Closing a pension", 3)
cl.sheet_view.showGridLines = False
cl.column_dimensions["A"].width = 3
cl.column_dimensions["B"].width = 50
cl.column_dimensions["C"].width = 20
cl.column_dimensions["E"].width = 70
label(cl, "B1", "Minimum still owed when a pension closes mid-year", H1)
label(cl, "B2", "The PDS says a pro-rata minimum 'may still need to be paid' on closure or commutation. Confirm the day count against the admin system before quoting.", MUTED)
for lc, text, vc, val, fmt in [
    ("B4", "Date of birth", "C4", "=BirthDate", DATE),
    ("B5", "Pension start date (original)", "C5", "=Start", DATE),
    ("B6", "Closure or commutation date", "C6", _dt.date(2027, 3, 31), DATE),
    ("B7", "Balance the year's minimum was based on", "C7", "=Balance", MONEY),
    ("B8", "Payments already made this financial year", "C8", 0, MONEY),
]:
    label(cl, lc, text)
    inp(cl, vc, val, fmt)
label(cl, "E4", "Defaults to the Calculator. Overwrite for another member.", MUTED)
label(cl, "E7", "The opening balance in the first year, otherwise the 1 July balance.", MUTED)
for nm, row in [("CBirthDate", 4), ("CStart", 5), ("CClose", 6), ("CBal", 7), ("CPaid", 8)]:
    define(nm, "Closing a pension", "C", row)
r = 10
for text, nm, f, fmt in [
    ("Financial year starts", "CFYStart", '=DATE(YEAR(CClose)-(MONTH(CClose)<7),7,1)', DATE),
    ("Period starts (later of 1 July and the pension start)", "CPStart", "=MAX(CFYStart,CStart)", DATE),
    ("Age at period start", "CAge", '=DATEDIF(CBirthDate,CPStart,"y")', "0"),
    ("Minimum percentage", "CPct", "=LOOKUP(CAge,BandAge,BandPct)", PCT),
    ("Days in the period, both ends included", "CDays", "=CClose-CPStart+1", "0"),
    ("Days in the financial year", "CDaysYr", "=DATE(YEAR(CFYStart)+1,6,30)-CFYStart+1", "0"),
    ("Pro-rata minimum to the closure date", "CProMin", "=ROUND(CBal*CPct*CDays/CDaysYr/RoundTo,0)*RoundTo", MONEY),
    ("Still to be paid before closing", "COwed", "=MAX(0,CProMin-CPaid)", MONEY),
]:
    label(cl, f"B{r}", text)
    out(cl, f"C{r}", f, fmt, bold=nm in ("CProMin", "COwed"))
    define(nm, "Closing a pension", "C", r)
    r += 1
cl[f"B{r + 1}"] = '=IF(CClose<CStart,"Closure date is before the pension started.","")'
cl[f"B{r + 1}"].font = Font(bold=True, color="B42318")

# ---- Checks -------------------------------------------------------------------
ck = wb.create_sheet("Checks", 4)
ck.sheet_view.showGridLines = False
label(ck, "A1", "Worked examples from the PDS", H1)
label(ck, "A2", "Each row recalculates a PDS example with this workbook's rules. All rows must say PASS.", MUTED)
heads = ["Example", "Inputs", "Workbook result", "PDS says", "Result"]
for i, h in enumerate(heads):
    c = ck.cell(4, 1 + i, h)
    c.font, c.fill = WHITE_BOLD, HEAD_FILL
checks = [
    ("Gavin: pro-rata minimum", "Age 67, starts 1 Oct 2026, $500,000",
     "=ROUND(500000*LOOKUP(67,BandAge,BandPct)*(DATE(2027,6,30)-DATE(2026,10,1)+1)/(DATE(2027,6,30)-DATE(2026,7,1)+1)/RoundTo,0)*RoundTo", 18700),
    ("Gavin: days remaining", "1 Oct 2026 to 30 Jun 2027", "=DATE(2027,6,30)-DATE(2026,10,1)+1", 273),
    ("Gavin: full-year minimum", "5% of $500,000", "=ROUND(500000*LOOKUP(67,BandAge,BandPct)/RoundTo,0)*RoundTo", 25000),
    ("Stacey: TTR minimum", "Age 62, starts 1 Jul 2026, $300,000", "=ROUND(300000*LOOKUP(62,BandAge,BandPct)*(DATE(2027,6,30)-DATE(2026,7,1)+1)/(DATE(2027,6,30)-DATE(2026,7,1)+1)/RoundTo,0)*RoundTo", 12000),
    ("Stacey: TTR maximum", "10% of $300,000", "=300000*TTRMaxPct", 30000),
    ("Bryn: TTR maximum per month", "$400,000 from 1 Apr 2027, 3 months", "=ROUNDDOWN(400000*TTRMaxPct/(13-(MOD(4-7,12)+1))/RoundTo,0)*RoundTo", 13330),
    ("Bryn: payments left", "Monthly from April", "=13-(MOD(4-7,12)+1)", 3),
]
for k, (ex, ins_, f, expect) in enumerate(checks):
    rr = 5 + k
    ck.cell(rr, 1, ex)
    ck.cell(rr, 2, ins_)
    ck.cell(rr, 3, f).number_format = "#,##0"
    ck.cell(rr, 4, expect).number_format = "#,##0"
    ck.cell(rr, 5, f'=IF(C{rr}=D{rr},"PASS","FAIL")').font = BOLD
last_check = 4 + len(checks)
ck.conditional_formatting.add(f"E5:E{last_check}", FormulaRule(formula=['E5="PASS"'], fill=OK_FILL))
ck.conditional_formatting.add(f"E5:E{last_check}", FormulaRule(formula=['E5="FAIL"'], fill=WARN_FILL))
ck.cell(last_check + 2, 1, "All checks").font = BOLD
ck.cell(last_check + 2, 5, f'=IF(COUNTIF(E5:E{last_check},"PASS")={len(checks)},"PASS","FAIL")').font = BOLD
define("AllChecks", "Checks", "E", last_check + 2)
ck.cell(last_check + 4, 1, "Calculator now: unrounded pro-rata minimum")
ck.cell(last_check + 4, 3, '=IF(PctNow="","",Balance*PctNow*DaysLeft/DaysYear)').number_format = MONEY_C
for col, w in zip("ABCDE", (34, 40, 18, 14, 10)):
    ck.column_dimensions[col].width = w

# ---- Assumptions: red labels with a hover comment, and a sheet listing them all ----
ASSUME_RED = Font(color="C02F49", bold=False)
ASSUME_LABELS = {
    "Calculator": {
        "Days in this financial year": "day-count",
        "Days left, counting the start date": "day-count",
        "Pro-rata minimum for the rest of this year": "day-count",
        "Payments left this year (estimate)": "payments-left",
        "Date of any fortnightly payment (optional)": "fortnightly",
        "Each payment at the minimum": "payment-rounding",
        "Each payment at the TTR maximum": "payment-rounding",
        "Each payment at the chosen amount": "payment-rounding",
        "Or age at start (if no date of birth)": "age-only",
    },
    "Closing a pension": {"Days in the period, both ends included": "closing-day-count", "Pro-rata minimum to the closure date": "closing-day-count"},
    "Full table": {"Days left": "day-count"},
}
for sheet_name, labels in ASSUME_LABELS.items():
    ws = wb[sheet_name]
    for row in ws.iter_rows():
        for cell in row:
            aid = labels.get(cell.value) if isinstance(cell.value, str) else None
            if aid:
                a = assumptions[aid]
                cell.font = Font(color="C02F49", bold=cell.font.bold, size=cell.font.size)
                cell.comment = Comment(f"ASSUMPTION: {a['title']}\n\n{a['assumed']}\n\nPDS: {a['pds']}\n\nTo be sure: {a['check']}", "Call companion", width=320, height=220)

asm = wb.create_sheet("Assumptions")
asm.sheet_view.showGridLines = False
label(asm, "A1", "Assumptions", H1)
label(asm, "A2", "Labels in red on the other sheets rely on one of these. Hover over a red label to see which.", MUTED)
for i, h in enumerate(["Assumption", "What's assumed", "What the PDS says", "To be sure"]):
    c = asm.cell(4, 1 + i, h)
    c.font, c.fill = WHITE_BOLD, HEAD_FILL
used = sorted({aid for labels in ASSUME_LABELS.values() for aid in labels.values()})
for k, aid in enumerate(used):
    a = assumptions[aid]
    for j, v in enumerate([a["title"], a["assumed"], a["pds"], a["check"]]):
        c = asm.cell(5 + k, 1 + j, v)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        if j == 0:
            c.font = Font(color="C02F49", bold=True)
for col, w in zip("ABCD", (30, 60, 60, 40)):
    asm.column_dimensions[col].width = w

# Protect every sheet so only the yellow input cells can be changed. On a protected sheet,
# Tab and Enter jump straight from one input to the next. No password: Review > Unprotect Sheet.
INPUTS = {
    "Calculator": [f"C{r}" for r in range(5, 14)],
    "Full table": ["C4", "C5"],
    "Closing a pension": ["C4", "C5", "C6", "C7", "C8"],
}
for ws in wb.worksheets:
    for ref in INPUTS.get(ws.title, []):
        ws[ref].protection = Protection(locked=False)
    ws.protection.sheet = True
    ws.protection.formatColumns = False
    ws.protection.autoFilter = False
cs.sheet_view.selection[0].activeCell = "C5"
cs.sheet_view.selection[0].sqref = "C5"

wb.calculation.fullCalcOnLoad = True
wb.save(OUT)
SITE = ROOT / "site"
SITE.mkdir(exist_ok=True)
wb.save(SITE / OUT.name)
print(f"Wrote {OUT} and site/{OUT.name}")
