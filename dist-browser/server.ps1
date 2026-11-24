# Palma City - local web server for the browser build.
#
# The game is a normal web page. Browsers refuse to load the game's textures and
# audio from a file:// page, so this script serves this folder over
# http://127.0.0.1 and opens your default browser at it. It uses a plain TCP
# listener (not HttpListener), so it needs no administrator rights and no
# firewall rule: the socket is bound to 127.0.0.1 only and nothing outside this
# PC can reach it.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$listener = $null
$port = 0
for ($p = 8765; $p -lt 8785; $p++) {
  try {
    $candidate = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $candidate.Start()
    $listener = $candidate
    $port = $p
    break
  } catch {
    # port busy: try the next one
  }
}

if (-not $listener) {
  Write-Host ""
  Write-Host "  Could not open a local port between 8765 and 8784." -ForegroundColor Red
  Write-Host "  Close other copies of Palma City and try again."
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}

$url = "http://127.0.0.1:$port/"
$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.gif'  = 'image/gif'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
  '.ttf'  = 'font/ttf'
  '.mp3'  = 'audio/mpeg'
  '.ogg'  = 'audio/ogg'
  '.wav'  = 'audio/wav'
  '.glb'  = 'model/gltf-binary'
  '.gltf' = 'model/gltf+json'
  '.bin'  = 'application/octet-stream'
}

Write-Host ""
Write-Host "  PALMA CITY" -ForegroundColor Yellow
Write-Host "  ------------------------------------------------------------"
Write-Host "  Running at $url"
Write-Host ""
Write-Host "  Your browser should open by itself. If it does not, open"
Write-Host "  Edge or Chrome and type the address above."
Write-Host ""
Write-Host "  Keep this window open while you play."
Write-Host "  Close it (or press Ctrl+C) to stop the game."
Write-Host "  ------------------------------------------------------------"
Write-Host ""

Start-Process $url

$rootFull = [System.IO.Path]::GetFullPath($root)
if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
  $rootFull = $rootFull + [System.IO.Path]::DirectorySeparatorChar
}

function Send-Bytes($stream, [byte[]]$bytes) {
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
}

function Send-Status($stream, $code, $text, $body) {
  $payload = [System.Text.Encoding]::UTF8.GetBytes($body)
  $head = "HTTP/1.1 $code $text`r`n" +
          "Content-Type: text/plain; charset=utf-8`r`n" +
          "Content-Length: $($payload.Length)`r`n" +
          "Cache-Control: no-store`r`n" +
          "Connection: close`r`n`r`n"
  Send-Bytes $stream ([System.Text.Encoding]::ASCII.GetBytes($head))
  Send-Bytes $stream $payload
}

while ($true) {
  $client = $null
  try {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $stream.ReadTimeout = 10000
    $stream.WriteTimeout = 30000

    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)
    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }

    # drain the headers; we do not need them, but they must leave the buffer
    $guard = 0
    while ($guard -lt 200) {
      $line = $reader.ReadLine()
      if ([string]::IsNullOrEmpty($line)) { break }
      $guard++
    }

    $parts = $requestLine.Split(' ')
    $method = $parts[0]
    $target = if ($parts.Length -ge 2) { $parts[1] } else { '/' }

    if ($method -ne 'GET' -and $method -ne 'HEAD') {
      Send-Status $stream 405 'Method Not Allowed' 'Method not allowed'
      continue
    }

    $target = $target.Split('?')[0]
    $target = [System.Uri]::UnescapeDataString($target)
    if ($target -eq '/' -or $target -eq '') { $target = '/index.html' }

    $rel = $target.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $full = [System.IO.Path]::GetFullPath((Join-Path $rootFull $rel))

    if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      Send-Status $stream 403 'Forbidden' 'Forbidden'
      continue
    }

    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
      Send-Status $stream 404 'Not Found' "Not found: $target"
      continue
    }

    $bytes = [System.IO.File]::ReadAllBytes($full)
    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $type = $types[$ext]
    if (-not $type) { $type = 'application/octet-stream' }

    $head = "HTTP/1.1 200 OK`r`n" +
            "Content-Type: $type`r`n" +
            "Content-Length: $($bytes.Length)`r`n" +
            "Cache-Control: no-cache`r`n" +
            "Connection: close`r`n`r`n"
    Send-Bytes $stream ([System.Text.Encoding]::ASCII.GetBytes($head))
    if ($method -eq 'GET') { Send-Bytes $stream $bytes }
  } catch {
    # a browser that closes a connection early is normal; keep serving
  } finally {
    if ($client) { try { $client.Close() } catch { } }
  }
}
