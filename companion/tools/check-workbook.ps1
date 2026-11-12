# Opens the drawdown workbook in Excel (read-only, never saved), runs scenarios through the
# Calculator and prints the results so the formulas are checked by Excel itself.
# Run: powershell -NoProfile -File companion/tools/check-workbook.ps1
$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot '..\dist\Flexi Pension drawdown calculator.xlsx' | Resolve-Path
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$failures = 0
try {
  $wb = $xl.Workbooks.Open($path.Path, 0, $true)
  $xl.CalculateFull()
  function GetRange($name) { $xl.Range($name) }
  function V($name) { (GetRange $name).Value2 }
  function T($name) { (GetRange $name).Text }
  function SetIn($name, $value) { $r = GetRange $name; [void]$r.GetType().InvokeMember("Value2", [Reflection.BindingFlags]::SetProperty, $null, $r, @($value)); $xl.Calculate() }
  function D($y, $m, $d) { (Get-Date -Year $y -Month $m -Day $d).Date.ToOADate() }
  function Expect($label, $actual, $expected) {
    $ok = "$actual" -eq "$expected"
    if (-not $ok) { $script:failures++ }
    '{0,-4} {1,-58} got {2,-22} expected {3}' -f ($(if ($ok) { 'ok' } else { 'FAIL' })), $label, $actual, $expected
  }

  Expect 'Checks sheet: all PDS examples' (V 'AllChecks') 'PASS'

  # Gavin: 67, starts 1 Oct 2026, $500,000, monthly
  SetIn 'BirthDate' (D 1959 5 14); SetIn 'Start' (D 2026 10 1); SetIn 'Balance' 500000
  SetIn 'PType' 'Retirement Phase'; SetIn 'Freq' 'Monthly'
  Expect 'Gavin age' (V 'AgeStart') 67
  Expect 'Gavin days left' (V 'DaysLeft') 273
  Expect 'Gavin pro-rata minimum' (V 'ProMin') 18700
  Expect 'Gavin monthly payments left' (V 'PayN') 9
  Expect 'Gavin each payment at minimum (18700/9 rounded up)' (V 'PerMin') 2080
  Expect 'Gavin maximum' (V 'MaxYr') 'No maximum'

  # Stacey: 62, TTR, 1 Jul 2026, $300,000
  SetIn 'BirthDate' (D 1964 3 2); SetIn 'Start' (D 2026 7 1); SetIn 'Balance' 300000; SetIn 'PType' 'TTR'
  Expect 'Stacey minimum' (V 'ProMin') 12000
  Expect 'Stacey maximum' (V 'MaxYr') 30000
  Expect 'Stacey range' (T 'AllowedRange') '$12,000 to $30,000'

  # Bryn: TTR, 1 Apr 2027, $400,000, monthly at the maximum
  SetIn 'BirthDate' (D 1965 8 20); SetIn 'Start' (D 2027 4 1); SetIn 'Balance' 400000
  Expect 'Bryn payments left' (V 'PayN') 3
  Expect 'Bryn each payment at maximum' (V 'PerMax') 13330

  # Quarterly from October: Dec, Mar, Jun
  SetIn 'Start' (D 2026 10 15); SetIn 'Freq' 'Quarterly'
  Expect 'Quarterly from October' (V 'PayN') 3
  SetIn 'Freq' 'Half-yearly'
  Expect 'Half-yearly from October' (V 'PayN') 2
  SetIn 'Start' (D 2027 1 15)
  Expect 'Half-yearly from January' (V 'PayN') 1

  # Fortnightly: anchor Friday 13 Nov 2026, start 1 Oct 2026 -> first pay 2 Oct 2026
  SetIn 'Freq' 'Fortnightly'; SetIn 'Start' (D 2026 10 1); SetIn 'Anchor' (D 2026 11 13)
  # Fridays every 14 days from 2 Oct 2026 to 30 Jun 2027: 2 Oct ... 25 Jun 2027 = 20
  Expect 'Fortnightly from 1 Oct 2026' (V 'PayN') 20
  SetIn 'Anchor' ''
  Expect 'Fortnightly, no payment date: estimate' (V 'PayN') 20

  # June start and leap year
  SetIn 'Freq' 'Monthly'; SetIn 'PType' 'Retirement Phase'; SetIn 'Start' (D 2028 6 10)
  Expect 'Leap year 2027-28 days in year' (V 'DaysYear') 366
  SetIn 'Start' (D 2027 6 10)
  Expect '2026-27 days in year' (V 'DaysYear') 365

  # Age step-up: 74 at a 1 Oct 2026 start, 75 by 1 July 2027
  SetIn 'Start' (D 2026 10 1); SetIn 'BirthDate' (D 1952 3 10)
  Expect 'Age 75 at next 1 July steps up' (T 'PctChange') 'Steps up from 5% to 6%'

  # Age only, no date of birth: Gavin's numbers from age 67
  SetIn 'Start' (D 2026 10 1); SetIn 'Balance' 500000; SetIn 'BirthDate' ''; SetIn 'AgeIn' 67; SetIn 'PType' 'Retirement Phase'
  Expect 'Age only: age used' (V 'AgeStart') 67
  Expect 'Age only: pro-rata minimum' (V 'ProMin') 18700
  SetIn 'PType' 'TTR'
  Expect 'Age only, TTR: maximum still worked out' (V 'MaxYr') 50000
  SetIn 'PType' 'Retirement Phase'; SetIn 'AgeIn' ''
  $sheet = $wb.Worksheets.Item('Calculator')
  Expect 'Calculator sheet is protected' ($sheet.ProtectContents) 'True'
  Expect 'Input cell C5 is unlocked' ($sheet.Range('C5').Locked) 'False'
  Expect 'Output cell C24 is locked' ($sheet.Range('C24').Locked) 'True'

  # Closing a pension: Gavin closes 31 Mar 2027 having been paid $10,000
  SetIn 'BirthDate' (D 1959 5 14); SetIn 'Start' (D 2026 10 1); SetIn 'Balance' 500000
  SetIn 'CPaid' 10000
  # 1 Oct 2026 to 31 Mar 2027 inclusive = 182 days; 500000*5%*182/365 = 12465.75 -> 12470
  Expect 'Closing: pro-rata minimum to 31 Mar 2027' (V 'CProMin') 12470
  Expect 'Closing: still owed' (V 'COwed') 2470

  "`n$failures failure(s)"
}
finally {
  if ($wb) { $wb.Close($false) }
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
if ($failures) { exit 1 }
