Add-Type -AssemblyName System.Drawing

$iconsDir = "C:\Users\Viabi\Documents\Projects\SAKAY\packages\shared\src\assets\icons"
$files = Get-ChildItem "$iconsDir\*onboarding*.png"

foreach ($file in $files) {
    $img = [System.Drawing.Image]::FromFile($file.FullName)
    $origW = $img.Width
    $origH = $img.Height
    $origSize = $file.Length

    # Target max width/height = 800px for crisp mobile display while keeping size low
    $maxDim = 800
    if ($origW -gt $maxDim -or $origH -gt $maxDim) {
        if ($origW -gt $origH) {
            $newW = $maxDim
            $newH = [int]($origH * ($maxDim / $origW))
        } else {
            $newH = $maxDim
            $newW = [int]($origW * ($maxDim / $origH))
        }
    } else {
        $newW = $origW
        $newH = $origH
    }

    $bmp = New-Object System.Drawing.Bitmap($newW, $newH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $g.DrawImage($img, 0, 0, $newW, $newH)

    $img.Dispose()
    $g.Dispose()

    $tempFile = "$($file.FullName).tmp"
    $bmp.Save($tempFile, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    Remove-Item $file.FullName
    Rename-Item $tempFile $file.FullName

    $newFile = Get-Item $file.FullName
    $reduction = [int]((1 - ($newFile.Length / $origSize)) * 100)
    Write-Host "$($file.Name): $($origW)x$($origH) ($([int]($origSize/1024)) KB) -> $($newW)x$($newH) ($([int]($newFile.Length/1024)) KB) - Reduced by $($reduction)%"
}
