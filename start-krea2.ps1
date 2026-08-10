$ErrorActionPreference = 'Stop'

$projectRoot = 'D:\RH'
$port = 5173
$url = "http://localhost:$port"

try {
  $listening = Test-NetConnection -ComputerName '127.0.0.1' -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
  if (-not $listening) {
    Start-Process -FilePath 'C:\Program Files\nodejs\npx.cmd' `
      -ArgumentList '-y', 'serve', $projectRoot, '-l', $port `
      -WorkingDirectory $projectRoot `
      -WindowStyle Hidden
    Start-Sleep -Seconds 2
  }

  Start-Process $url
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Krea 2 启动失败：$($_.Exception.Message)", 'Krea 2 RunningHub') | Out-Null
}
