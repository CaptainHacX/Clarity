$ErrorActionPreference = 'Stop'

$version = '1.0.1'

$packageArgs = @{
  packageName    = 'clarity'
  fileType       = 'exe'
  url64bit       = "https://github.com/CaptainHacX/Clarity/releases/download/v$version/Clarity-Setup-$version.exe"
  silentArgs     = '/S'
  validExitCodes = @(0)
  checksum64     = '__REPLACE_WITH_SHA256_HASH__'
  checksumType64 = 'sha256'
}

Install-ChocolateyPackage @packageArgs
