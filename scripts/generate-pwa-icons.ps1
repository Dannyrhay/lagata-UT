Add-Type -AssemblyName System.Drawing

$outputDirectory = Join-Path $PSScriptRoot "..\public\icons"
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null

function New-RoundedRectanglePath([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
  $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
  $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Write-LagataIcon([int]$size, [string]$name, [bool]$maskable) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $deep = [System.Drawing.ColorTranslator]::FromHtml("#0b1510")
  $panel = [System.Drawing.ColorTranslator]::FromHtml("#111d16")
  $lime = [System.Drawing.ColorTranslator]::FromHtml("#b9f227")
  $soft = [System.Drawing.ColorTranslator]::FromHtml("#eaffb2")
  $graphics.Clear($(if ($maskable) { $lime } else { $deep }))

  $margin = $(if ($maskable) { [int]($size * .20) } else { [int]($size * .07) })
  $tileSize = $size - ($margin * 2)
  $tile = New-RoundedRectanglePath $margin $margin $tileSize $tileSize ($size * .16)
  $graphics.FillPath([System.Drawing.SolidBrush]::new($panel), $tile)
  $graphics.DrawPath([System.Drawing.Pen]::new($lime, [Math]::Max(2, $size * .012)), $tile)

  $linePen = [System.Drawing.Pen]::new($lime, [Math]::Max(4, $size * .032))
  $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $points = [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($margin + $tileSize * .16, $margin + $tileSize * .54),
    [System.Drawing.PointF]::new($margin + $tileSize * .32, $margin + $tileSize * .56),
    [System.Drawing.PointF]::new($margin + $tileSize * .39, $margin + $tileSize * .28),
    [System.Drawing.PointF]::new($margin + $tileSize * .46, $margin + $tileSize * .54),
    [System.Drawing.PointF]::new($margin + $tileSize * .64, $margin + $tileSize * .51)
  )
  $graphics.DrawLines($linePen, $points)

  $fontSize = $tileSize * .20
  $font = [System.Drawing.Font]::new("Arial", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textArea = [System.Drawing.RectangleF]::new($margin + $tileSize * .52, $margin + $tileSize * .37, $tileSize * .36, $tileSize * .34)
  $graphics.DrawString("UT", $font, [System.Drawing.SolidBrush]::new($soft), $textArea, $format)

  $bitmap.Save((Join-Path $outputDirectory $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $format.Dispose(); $font.Dispose(); $linePen.Dispose(); $tile.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}

Write-LagataIcon 180 "apple-touch-icon.png" $false
Write-LagataIcon 192 "icon-192.png" $false
Write-LagataIcon 512 "icon-512.png" $false
Write-LagataIcon 192 "icon-192-maskable.png" $true
Write-LagataIcon 512 "icon-512-maskable.png" $true
