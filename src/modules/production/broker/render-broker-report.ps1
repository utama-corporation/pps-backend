param(
  [Parameter(Mandatory = $true)][string]$DataJson,
  [Parameter(Mandatory = $true)][string]$OutPdf,
  [string]$RptPath = "E:\JOB\PPS Project\20230926\Plastic Production System_(PPS)\Plastic Production System\Plastic Production System\Report\CrProduksiBroker22.rpt"
)
$ErrorActionPreference = "Stop"
[void][Reflection.Assembly]::LoadWithPartialName("CrystalDecisions.CrystalReports.Engine")
[void][Reflection.Assembly]::LoadWithPartialName("CrystalDecisions.Shared")

$cfg = Get-Content -Raw -LiteralPath $DataJson | ConvertFrom-Json

function New-MainTable {
  $dt = New-Object System.Data.DataTable "DtBrokerProduksi"
  foreach ($c in @(
      @("Tipe", [string]), @("Group", [string]), @("NoProduksi", [string]),
      @("TglProduksi", [string]), @("NamaMesin", [string]), @("Shift", [int]),
      @("Jenis", [string]), @("Berat", [decimal]), @("TimeStart", [string]),
      @("TimeEnd", [string]), @("CreateBy", [string]), @("CheckBy1", [string]),
      @("CheckBy2", [string]), @("ApproveBy", [string]), @("JmlhAnggota", [int]),
      @("Hadir", [int]), @("Stat", [string]), @("Remarks", [string]),
      @("NoLabel", [string])
    )) {
    [void]$dt.Columns.Add($c[0], $c[1])
  }
  foreach ($row in $cfg.main) {
    $r = $dt.NewRow()
    foreach ($col in $dt.Columns) {
      $v = $row.$($col.ColumnName)
      if ($null -eq $v -or ($v -is [string] -and $v -eq "")) {
        $r[$col] = [DBNull]::Value
      } else {
        $r[$col] = $v
      }
    }
    [void]$dt.Rows.Add($r)
  }
  return ,$dt
}

function New-DowntimeTable {
  $dt = New-Object System.Data.DataTable "DtDowntimeBroker"
  foreach ($c in @(
      @("NoProduksi", [string]), @("NoUrut", [int]), @("TimeStart", [string]),
      @("TimeEnd", [string]), @("Remarks", [string]), @("DurasiDetik", [int]),
      @("DurasiMenit", [decimal]), @("DurasiHHMMSS", [string])
    )) {
    [void]$dt.Columns.Add($c[0], $c[1])
  }
  foreach ($row in $cfg.downtime) {
    $r = $dt.NewRow()
    foreach ($col in $dt.Columns) {
      $v = $row.$($col.ColumnName)
      if ($null -eq $v -or ($v -is [string] -and $v -eq "")) {
        $r[$col] = [DBNull]::Value
      } else {
        $r[$col] = $v
      }
    }
    [void]$dt.Rows.Add($r)
  }
  return ,$dt
}

$mainTable = New-MainTable
$downtimeTable = New-DowntimeTable

$rpt = New-Object CrystalDecisions.CrystalReports.Engine.ReportDocument
try {
  $rpt.Load($RptPath)
  $rpt.SetDataSource($mainTable)

  foreach ($sr in $rpt.Subreports) {
    if ($sr.Name -eq "Down" -or $sr.Name -eq "DownTotal") {
      $sr.SetDataSource($downtimeTable)
    } else {
      $sr.SetDataSource($mainTable)
    }
  }

  $rpt.SetParameterValue("Username", [string]$cfg.by)

  $rpt.ExportToDisk([CrystalDecisions.Shared.ExportFormatType]::PortableDocFormat, $OutPdf)
} finally {
  $rpt.Close()
  $rpt.Dispose()
}

Write-Output $OutPdf
