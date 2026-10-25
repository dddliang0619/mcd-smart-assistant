Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$iconDirectory = Join-Path $projectRoot 'miniprogram/assets/tabbar'
[System.IO.Directory]::CreateDirectory($iconDirectory) | Out-Null

foreach ($state in @('default', 'active')) {
  $hex = if ($state -eq 'active') { '#DB0007' } else { '#8B9098' }
  foreach ($name in @('order', 'orders', 'account')) {
    $bitmap = [System.Drawing.Bitmap]::new(216, 216)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.ScaleTransform(3, 3)
    $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($hex), 3.8)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    if ($name -eq 'order') {
      $graphics.DrawArc($pen, 13, 23, 46, 44, 180, 180)
      $graphics.DrawLine($pen, 10, 46, 62, 46)
      $graphics.DrawLine($pen, 15, 55, 57, 55)
      $graphics.DrawLine($pen, 36, 16, 36, 22)
      $graphics.DrawLine($pen, 31, 15, 41, 15)
    } elseif ($name -eq 'orders') {
      $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
      $points = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(19, 10), [System.Drawing.PointF]::new(53, 10),
        [System.Drawing.PointF]::new(53, 61), [System.Drawing.PointF]::new(45, 56),
        [System.Drawing.PointF]::new(36, 61), [System.Drawing.PointF]::new(27, 56),
        [System.Drawing.PointF]::new(19, 61)
      )
      $path.AddPolygon($points)
      $graphics.DrawPath($pen, $path)
      $graphics.DrawLine($pen, 27, 23, 45, 23)
      $graphics.DrawLine($pen, 27, 32, 42, 32)
      $graphics.DrawLine($pen, 28, 43, 34, 48)
      $graphics.DrawLine($pen, 34, 48, 44, 39)
      $path.Dispose()
    } else {
      $graphics.DrawEllipse($pen, 26, 10, 20, 20)
      $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
      $path.AddBezier(15, 60, 15, 29, 57, 29, 57, 60)
      $path.AddLine(57, 60, 15, 60)
      $graphics.DrawPath($pen, $path)
      $path.Dispose()
    }
    $small = [System.Drawing.Bitmap]::new(72, 72)
    $downsample = [System.Drawing.Graphics]::FromImage($small)
    $downsample.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $downsample.DrawImage($bitmap, 0, 0, 72, 72)
    $small.Save((Join-Path $iconDirectory ($name + '-' + $state + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
    $downsample.Dispose(); $small.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
  }
}
Write-Output 'Generated six transparent tab icons (72x72).'
